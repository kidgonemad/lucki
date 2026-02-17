const fs = require('fs');
const buf = fs.readFileSync('public/assets/lucki-tv.glb');

const version = buf.readUInt32LE(4);
const length = buf.readUInt32LE(8);
console.log('GLB version:', version, 'Total size:', length);

const chunk0Len = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + chunk0Len).toString('utf8'));

console.log('\n=== MESHES (' + (json.meshes || []).length + ') ===');
(json.meshes || []).forEach(function(m, i) {
  console.log(i + ': ' + m.name + ' - primitives: ' + m.primitives.length);
  m.primitives.forEach(function(p, j) {
    console.log('  prim ' + j + ' - material: ' + p.material + ' - attrs: ' + Object.keys(p.attributes).join(', '));
  });
});

console.log('\n=== MATERIALS (' + (json.materials || []).length + ') ===');
(json.materials || []).forEach(function(m, i) {
  console.log(i + ': ' + m.name);
  if (m.pbrMetallicRoughness) {
    var pbr = m.pbrMetallicRoughness;
    if (pbr.baseColorTexture) console.log('  baseColorTexture: ' + JSON.stringify(pbr.baseColorTexture));
    if (pbr.metallicRoughnessTexture) console.log('  metallicRoughnessTexture: ' + JSON.stringify(pbr.metallicRoughnessTexture));
    if (pbr.baseColorFactor) console.log('  baseColorFactor: ' + JSON.stringify(pbr.baseColorFactor));
    console.log('  metallicFactor: ' + pbr.metallicFactor + ', roughnessFactor: ' + pbr.roughnessFactor);
  }
  if (m.normalTexture) console.log('  normalTexture: ' + JSON.stringify(m.normalTexture));
  if (m.occlusionTexture) console.log('  occlusionTexture: ' + JSON.stringify(m.occlusionTexture));
  if (m.emissiveTexture) console.log('  emissiveTexture: ' + JSON.stringify(m.emissiveTexture));
  if (m.emissiveFactor) console.log('  emissiveFactor: ' + JSON.stringify(m.emissiveFactor));
});

console.log('\n=== TEXTURES (' + (json.textures || []).length + ') ===');
(json.textures || []).forEach(function(t, i) {
  console.log(i + ': ' + JSON.stringify(t));
});

console.log('\n=== IMAGES (' + (json.images || []).length + ') ===');
(json.images || []).forEach(function(img, i) {
  var info = img.name || img.uri || ('bufferView:' + img.bufferView);
  console.log(i + ': ' + info + ' ' + (img.mimeType || ''));
});

console.log('\n=== NODES (first 40 of ' + (json.nodes || []).length + ') ===');
(json.nodes || []).slice(0, 40).forEach(function(n, i) {
  var meshInfo = (n.mesh !== undefined) ? ' (mesh:' + n.mesh + ')' : '';
  var childInfo = n.children ? ' children:' + n.children.length : '';
  console.log(i + ': ' + n.name + meshInfo + childInfo);
});
if ((json.nodes || []).length > 40) console.log('  ... and ' + (json.nodes.length - 40) + ' more nodes');

// Check if texCoord 1 is used (for AO maps)
console.log('\n=== UV SETS CHECK ===');
(json.meshes || []).forEach(function(m, i) {
  m.primitives.forEach(function(p, j) {
    var hasUV0 = !!p.attributes.TEXCOORD_0;
    var hasUV1 = !!p.attributes.TEXCOORD_1;
    if (hasUV0 || hasUV1) {
      console.log('mesh ' + i + ' prim ' + j + ': UV0=' + hasUV0 + ' UV1=' + hasUV1);
    }
  });
});
