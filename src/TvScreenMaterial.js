import { MeshStandardMaterial } from 'three'

export default class TvScreenMaterial extends MeshStandardMaterial {
  constructor(params = {}) {
    super(params)

    this._uniforms = {
      uTime: { value: 0 },
      uScanCount: { value: 400.0 },
      uScanIntensity: { value: 0.12 },
      uStaticAmount: { value: 0.04 },
      uNoSignal: { value: 1.0 },
      uDistortion: { value: 0.003 },
      uFlipY: { value: 1.0 },
      uPower: { value: 1.0 },
      tTvUi: { value: null },
    }
  }

  get time() { return this._uniforms.uTime.value }
  set time(v) { this._uniforms.uTime.value = v }

  get power() { return this._uniforms.uPower.value }
  set power(v) { this._uniforms.uPower.value = v }

  get noSignal() { return this._uniforms.uNoSignal.value }
  set noSignal(v) { this._uniforms.uNoSignal.value = v }

  get staticAmount() { return this._uniforms.uStaticAmount.value }
  set staticAmount(v) { this._uniforms.uStaticAmount.value = v }

  get mapFlipY() { return this._uniforms.uFlipY.value }
  set mapFlipY(v) { this._uniforms.uFlipY.value = v }

  get tvUiTexture() { return this._uniforms.tTvUi.value }
  set tvUiTexture(v) { this._uniforms.tTvUi.value = v }

  onBeforeCompile(shader) {
    Object.assign(shader.uniforms, this._uniforms)

    shader.fragmentShader = /* glsl */ `
      uniform float uTime;
      uniform float uScanCount;
      uniform float uScanIntensity;
      uniform float uStaticAmount;
      uniform float uNoSignal;
      uniform float uDistortion;
      uniform float uFlipY;
      uniform float uPower;
      uniform sampler2D tTvUi;

      float crtRand(vec2 co) {
        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
      }

      vec2 crtBarrel(vec2 uv) {
        vec2 cc = uv - 0.5;
        float d = dot(cc, cc);
        return uv + cc * d * uDistortion * 40.0;
      }
    ` + shader.fragmentShader

    // Replace map_fragment — CRT-processed texture sampling
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
        #ifdef USE_MAP
          // CRT UV — always flipped for effects, scanlines, TVUI overlay
          vec2 crtUv = crtBarrel(vec2(vMapUv.x, 1.0 - vMapUv.y));

          // Texture UV — flip Y only for video (uFlipY=1), not for images (uFlipY=0)
          float texY = mix(vMapUv.y, 1.0 - vMapUv.y, uFlipY);
          vec2 texUv = crtBarrel(vec2(vMapUv.x, texY));

          // Sample the main texture
          vec4 texColor = texture2D(map, texUv);

          // --- No-signal mode: blue screen with heavy static ---
          if (uNoSignal > 0.5) {
            float noise = crtRand(crtUv * 200.0 + vec2(uTime * 3.0, uTime * 1.7));
            float bands = sin(crtUv.y * 80.0 + uTime * 10.0) * 0.5 + 0.5;
            vec3 blue = vec3(0.0, 0.08, 0.35);
            vec3 staticCol = mix(blue, vec3(noise * 0.6), 0.3 + bands * 0.15);
            texColor = vec4(staticCol, 1.0);
          }

          // --- Blend TV UI overlay (alpha compositing) ---
          vec4 tvUi = texture2D(tTvUi, crtUv);
          texColor.rgb = mix(texColor.rgb, tvUi.rgb, tvUi.a);

          // --- Scanlines ---
          float scanline = sin(crtUv.y * uScanCount * 3.14159) * 0.5 + 0.5;
          scanline = 1.0 - scanline * uScanIntensity;
          texColor.rgb *= scanline;

          // --- Static noise overlay ---
          float staticNoise = crtRand(crtUv + vec2(uTime * 0.7, uTime * 1.3));
          texColor.rgb += (staticNoise - 0.5) * uStaticAmount;

          // --- Film grain ---
          float grain = crtRand(crtUv + vec2(uTime * 0.01)) * 0.04 * 0.01;
          texColor.rgb += grain;

          // --- Slight vignette ---
          vec2 vig = crtUv - 0.5;
          float vigAmount = 1.0 - dot(vig, vig) * 1.2;
          texColor.rgb *= clamp(vigAmount, 0.0, 1.0);

          // --- CRT power on/off ---
          if (uPower < 0.99) {
            // Vertical squeezes first, then horizontal
            float vOpen = smoothstep(0.0, 0.8, uPower);
            float hOpen = smoothstep(0.0, 0.35, uPower);

            float dy = abs(crtUv.y - 0.5);
            float dx = abs(crtUv.x - 0.5);

            float edge = 0.006;
            float vMask = 1.0 - smoothstep(vOpen * 0.5 - edge, vOpen * 0.5 + edge, dy);
            float hMask = 1.0 - smoothstep(hOpen * 0.5 - edge, hOpen * 0.5 + edge, dx);
            float mask = vMask * hMask;

            // Phosphor glow — image brightens as it collapses
            float glow = 1.0 + (1.0 - uPower) * 3.0;
            texColor.rgb *= mask * glow;

            // White center dot during collapse
            float centerDist = length((crtUv - 0.5) * vec2(1.6, 1.0));
            float centerGlow = (1.0 - uPower) * 0.5 * exp(-centerDist * 10.0);
            texColor.rgb += vec3(centerGlow);
          }

          diffuseColor *= texColor;
        #endif
      `
    )

    // Replace emissivemap_fragment — use CRT-processed content for screen glow
    // Without this, the raw texture bleeds through as emissive even during noSignal
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `
        #ifdef USE_EMISSIVEMAP
          totalEmissiveRadiance *= texColor.rgb;
        #endif
      `
    )
  }
}
