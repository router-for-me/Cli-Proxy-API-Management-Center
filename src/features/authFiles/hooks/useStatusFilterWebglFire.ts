import { useEffect, useRef } from 'react';

const VERT = `#version 300 es
  layout(location=0) in vec2 a_pos;
  out vec2 v_uv;
  void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }
`;

const FRAG_SIM = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform float u_time, u_slider, u_elapsed, u_grid_x;
  uniform vec3 u_ember, u_glow, u_core;
  uniform sampler2D u_back;
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  void main(){
    vec2 uv=v_uv;
    vec2 g=uv*vec2(u_grid_x,6.0);
    vec2 id=floor(g);
    vec2 cf=fract(g);
    float h=hash(id);
    vec2 ap=abs(cf-0.5);
    float cell=smoothstep(0.34,0.22,max(ap.x*0.9,ap.y));
    vec3 prev=texture(u_back,uv).rgb;
    float fade_mask = smoothstep(0.0, 0.45, uv.x);
    vec3 decay = prev * 0.90 * fade_mask;
    float act=smoothstep(0.95,1.0,u_slider);
    if(act<0.01||u_elapsed<0.0){ fc=vec4(decay,1.0); return; }
    float t=u_time;
    float cellDelay = h * 1.2;
    float cellAge   = max(u_elapsed - cellDelay, 0.0);
    float ignited   = step(0.001, cellAge);
    float cellSpd   = 0.85 + h * 0.30;
    float eased = 1.0 - pow(1.0 - clamp(cellAge / 2.5, 0.0, 1.0), 3.0);
    float dist  = eased * u_slider * cellSpd * ignited;
    float cellOff = (h - 0.5) * 0.05;
    float front   = max(u_slider - dist - cellOff, 0.02);
    float tail    = max(u_slider - front, 0.001);
    float inZ   = step(front - 0.003, uv.x) * step(uv.x, u_slider + 0.003);
    float dn    = clamp(max(u_slider - uv.x, 0.0) / tail, 0.0, 1.0);
    float bright = pow(1.0 - dn, 0.65);
    bright = max(bright, 0.04 * ignited) * inZ;
    bright *= 1.0 - smoothstep(0.94, 1.05, dn);
    float es = mix(0.15, 0.5, min(u_elapsed / 1.0, 1.0));
    float vy = abs(uv.y - 0.5) * 2.0;
    float vf = pow(max(1.0 - vy * vy * 0.45, 0.0), 0.75);
    float ts = mix(0.85, 1.0, min(u_elapsed / 1.5, 1.0));
    float f1 = sin(uv.x * 30.0 + t * 15.0 * ts + h * 6.28);
    float f2 = sin(uv.x * 17.0 + t * 8.0 * ts + h * 3.14);
    float f3 = sin(uv.x * 52.0 + t * 25.0 * ts + h * 10.0);
    float flame = smoothstep(0.08, 0.92, (f1 + f2 * 0.5 + f3 * 0.25) * 0.35 + 0.5);
    float r1 = sin(dn * 16.0 - t * 5.0 * ts + h * 3.0);
    float r2 = sin(dn * 8.0 - t * 2.5 * ts + h * 5.0);
    float rhythm = smoothstep(-0.15, 0.55, r1) * (r2 * 0.5 + 0.5);
    rhythm = pow(max(rhythm, 0.0), 1.2);
    float avgSpd = dist / max(cellAge, 0.001);
    float age    = max(cellAge - max(u_slider - uv.x, 0.0) / max(avgSpd, 0.001), 0.0);
    float flash  = step(0.0, age) * exp(-age * 3.2);
    float sp  = fract(t * (0.38 + h * 0.15) + h * 7.0);
    float sX  = u_slider - sp * tail;
    float sY  = 0.5 + sin(sp * 11.0 + h * 6.28) * 0.28;
    float spark = smoothstep(0.014, 0.0, abs(uv.x - sX))
                * smoothstep(0.18, 0.0, abs(uv.y - sY))
                * (1.0 - sp) * (1.0 - sp) * es;
    float energy = bright * vf * (flame * 0.42 + rhythm * 0.38)
                 + flash * bright * vf * 0.55
                 + spark * 0.7 * inZ;
    energy *= es;
    float edgeBase = exp(-pow((uv.x - front) * 18.0, 2.0));
    float ef1 = sin(uv.x * 45.0 + t * 20.0 * ts + h * 6.28) * 0.5 + 0.5;
    float ef2 = sin(uv.x * 28.0 + t * 11.0 * ts + h * 3.14) * 0.5 + 0.5;
    float edge = edgeBase * (0.25 + ef1 * ef2 * 1.5) * 1.6 * act * es;
    float leadD    = front - uv.x;
    float leadZone = smoothstep(0.07, 0.0, leadD) * step(0.0, leadD) * vf;
    float h2       = hash(id + vec2(99.0, 33.0));
    float leadF    = sin(leadD * 100.0 + t * 20.0 * ts + h2 * 6.28) * 0.5 + 0.5;
    float leadSpark = leadZone * step(0.6, h2) * leadF * act * es * 0.5;
    float total = energy + edge + leadSpark;
    vec3 ember = u_ember;
    vec3 wpur  = u_glow;
    vec3 wht   = u_core;
    float temp = 1.0 - dn;
    vec3 col   = mix(ember, wpur, temp);
    col        = mix(col, wht, pow(temp, 4.5));
    col       *= total;
    float pulse = sin(t * 2.8) * 0.15 + 1.0;
    float core  = exp(-pow((uv.x - u_slider) * 16.0, 2.0));
    col += wht * core * 2.2 * pulse * act * es;
    col += wpur * exp(-pow((uv.x - u_slider) * 3.5, 2.0)) * 0.12 * act * es;
    col *= cell;
    col *= fade_mask;
    fc = vec4(min(decay + col, vec3(1.5)), 1.0);
  }
`;

const FRAG_BLUR = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform sampler2D u_tex;
  uniform vec2 u_dir, u_res;
  uniform float u_ext;
  vec3 s(vec2 uv){
    vec3 c=texture(u_tex,uv).rgb;
    return u_ext>0.5 && dot(c,vec3(0.2126,0.7152,0.0722))<0.3 ? vec3(0.0) : c;
  }
  void main(){
    vec2 o=u_dir*1.8/u_res;
    vec3 r=s(v_uv)*0.227027;
    r+=s(v_uv+o)*0.194595;    r+=s(v_uv-o)*0.194595;
    r+=s(v_uv+o*2.0)*0.121622;r+=s(v_uv-o*2.0)*0.121622;
    r+=s(v_uv+o*3.0)*0.054054;r+=s(v_uv-o*3.0)*0.054054;
    fc=vec4(r,1.0);
  }
`;

const FRAG_COMP = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 fc;
  uniform sampler2D u_scene, u_glow;
  void main(){
    vec3 s=texture(u_scene,v_uv).rgb;
    vec3 g=texture(u_glow,v_uv).rgb;
    fc=vec4(1.0-exp(-(s+g*1.2+s*g*0.35)*1.15),1.0);
  }
`;

type FBO = {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
};

type Rgb = readonly [number, number, number];

type ThemeFireColors = {
  ember: Rgb;
  glow: Rgb;
  core: Rgb;
};

const BASE_GRID_WIDTH_PX = 256;
const BASE_GRID_COLUMNS = 58;
const FALLBACK_WARNING_COLOR: Rgb = [198 / 255, 87 / 255, 70 / 255];
const FALLBACK_PRIMARY_COLOR: Rgb = [139 / 255, 134 / 255, 128 / 255];
const FALLBACK_CONTRAST_COLOR: Rgb = [1, 1, 1];
const FALLBACK_FIRE_COLORS: ThemeFireColors = {
  ember: [0.38, 0.14, 0.1],
  glow: [0.78, 0.34, 0.27],
  core: [1, 0.9, 0.86],
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function parseCssColor(value: string): Rgb | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hex = trimmed.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    const raw = hex[1];
    const expanded =
      raw.length === 3
        ? raw
            .split('')
            .map((part) => `${part}${part}`)
            .join('')
        : raw;
    const parsed = Number.parseInt(expanded, 16);
    return [
      ((parsed >> 16) & 255) / 255,
      ((parsed >> 8) & 255) / 255,
      (parsed & 255) / 255,
    ];
  }

  const rgb = trimmed.match(/^rgba?\((.+)\)$/i);
  if (!rgb) return null;

  const channels = rgb[1]
    .replace(/\s*\/.*$/, '')
    .split(/[,\s]+/)
    .filter(Boolean)
    .slice(0, 3);
  if (channels.length !== 3) return null;

  const normalized = channels.map((channel) => {
    if (channel.endsWith('%')) {
      return clamp01(Number.parseFloat(channel) / 100);
    }
    return clamp01(Number.parseFloat(channel) / 255);
  });
  if (normalized.some((channel) => Number.isNaN(channel))) return null;

  return [normalized[0], normalized[1], normalized[2]];
}

function mixRgb(from: Rgb, to: Rgb, toRatio: number): Rgb {
  const ratio = clamp01(toRatio);
  return [
    from[0] * (1 - ratio) + to[0] * ratio,
    from[1] * (1 - ratio) + to[1] * ratio,
    from[2] * (1 - ratio) + to[2] * ratio,
  ];
}

function resolveThemeFireColors(canvasEl: HTMLCanvasElement): ThemeFireColors {
  const elementStyle = window.getComputedStyle(canvasEl);
  const rootStyle = window.getComputedStyle(document.documentElement);
  const readCssVar = (name: string) =>
    parseCssColor(elementStyle.getPropertyValue(name)) ??
    parseCssColor(rootStyle.getPropertyValue(name));
  const warning = readCssVar('--warning-color') ?? FALLBACK_WARNING_COLOR;
  const primary = readCssVar('--primary-color') ?? FALLBACK_PRIMARY_COLOR;
  const contrast = readCssVar('--primary-contrast') ?? FALLBACK_CONTRAST_COLOR;

  return {
    ember: mixRgb(warning, [0, 0, 0], 0.46),
    glow: mixRgb(warning, primary, 0.18),
    core: mixRgb(warning, contrast, 0.72),
  };
}

export function useStatusFilterWebglFire(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  sliderValue: number,
  isActive: boolean
) {
  const sliderValueRef = useRef(sliderValue);
  const isActiveRef = useRef(isActive);
  const ultraStartRef = useRef<number | null>(null);
  const apiRef = useRef({ ensureLoop: () => {} });

  useEffect(() => {
    sliderValueRef.current = sliderValue;
  }, [sliderValue]);

  useEffect(() => {
    isActiveRef.current = isActive;
    if (isActive) {
      ultraStartRef.current = performance.now();
      apiRef.current.ensureLoop();
    } else {
      ultraStartRef.current = null;
    }
  }, [isActive]);

  useEffect(() => {
    let gl: WebGL2RenderingContext | null = null;
    let canvasEl: HTMLCanvasElement | null = null;
    let rafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeDebounce: ReturnType<typeof setTimeout> | null = null;

    let loopRunning = false;
    let idleFrames = 0;
    let wasActive = false;

    let simProg: WebGLProgram | null = null;
    let blurProg: WebGLProgram | null = null;
    let compProg: WebGLProgram | null = null;
    let vao: WebGLVertexArrayObject | null = null;
    let vbo: WebGLBuffer | null = null;
    let programsReady = false;

    let simA: FBO | null = null;
    let simB: FBO | null = null;
    let blurH: FBO | null = null;
    let blurV: FBO | null = null;

    const U: Record<string, WebGLUniformLocation | null> = {
      simTime: null,
      simSlider: null,
      simElapsed: null,
      simGridX: null,
      simEmber: null,
      simGlow: null,
      simCore: null,
      simBack: null,
      blurDir: null,
      blurExt: null,
      blurTex: null,
      blurRes: null,
      compScene: null,
      compGlow: null,
    };

    const MAX_IDLE = 180;
    let gridColumns = BASE_GRID_COLUMNS;
    let themeFireColors = FALLBACK_FIRE_COLORS;
    let themeObserver: MutationObserver | null = null;

    function onContextLost(e: Event) {
      e.preventDefault();
    }

    function onContextRestored() {
      compilePrograms();
      if (programsReady) {
        resize();
        if (isActiveRef.current) ensureLoop();
      }
    }

    function compileShader(type: number, src: string) {
      if (!gl) return null;
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }

    function linkProgram(vsSrc: string, fsSrc: string) {
      if (!gl) return null;
      const v = compileShader(gl.VERTEX_SHADER, vsSrc);
      const f = compileShader(gl.FRAGMENT_SHADER, fsSrc);
      if (!v || !f) return null;
      const p = gl.createProgram();
      if (!p) return null;
      gl.attachShader(p, v);
      gl.attachShader(p, f);
      gl.bindAttribLocation(p, 0, 'a_pos');
      gl.linkProgram(p);
      gl.deleteShader(v);
      gl.deleteShader(f);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(p));
        return null;
      }
      return p;
    }

    function compilePrograms() {
      if (!gl) return;
      simProg = linkProgram(VERT, FRAG_SIM);
      blurProg = linkProgram(VERT, FRAG_BLUR);
      compProg = linkProgram(VERT, FRAG_COMP);
      if (!simProg || !blurProg || !compProg) return;

      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      U.simTime = gl.getUniformLocation(simProg, 'u_time');
      U.simSlider = gl.getUniformLocation(simProg, 'u_slider');
      U.simElapsed = gl.getUniformLocation(simProg, 'u_elapsed');
      U.simGridX = gl.getUniformLocation(simProg, 'u_grid_x');
      U.simEmber = gl.getUniformLocation(simProg, 'u_ember');
      U.simGlow = gl.getUniformLocation(simProg, 'u_glow');
      U.simCore = gl.getUniformLocation(simProg, 'u_core');
      U.simBack = gl.getUniformLocation(simProg, 'u_back');
      U.blurDir = gl.getUniformLocation(blurProg, 'u_dir');
      U.blurExt = gl.getUniformLocation(blurProg, 'u_ext');
      U.blurTex = gl.getUniformLocation(blurProg, 'u_tex');
      U.blurRes = gl.getUniformLocation(blurProg, 'u_res');
      U.compScene = gl.getUniformLocation(compProg, 'u_scene');
      U.compGlow = gl.getUniformLocation(compProg, 'u_glow');

      programsReady = true;
    }

    function makeFBO(): FBO | null {
      if (!gl || !canvasEl) return null;
      const fbo = gl.createFramebuffer();
      const tex = gl.createTexture();
      if (!fbo || !tex) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        canvasEl.width,
        canvasEl.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { fbo, tex };
    }

    function createFBOs() {
      if (!gl || !canvasEl) return;
      simA = makeFBO();
      simB = makeFBO();
      blurH = makeFBO();
      blurV = makeFBO();
    }

    function destroyFBO(entry: FBO | null) {
      if (!gl || !entry) return;
      gl.deleteFramebuffer(entry.fbo);
      gl.deleteTexture(entry.tex);
    }

    function destroyFBOs() {
      destroyFBO(simA);
      simA = null;
      destroyFBO(simB);
      simB = null;
      destroyFBO(blurH);
      blurH = null;
      destroyFBO(blurV);
      blurV = null;
    }

    function refreshThemeFireColors() {
      if (!canvasEl) return;
      themeFireColors = resolveThemeFireColors(canvasEl);
    }

    function destroyPrograms() {
      if (!gl) return;
      if (simProg) {
        gl.deleteProgram(simProg);
        simProg = null;
      }
      if (blurProg) {
        gl.deleteProgram(blurProg);
        blurProg = null;
      }
      if (compProg) {
        gl.deleteProgram(compProg);
        compProg = null;
      }
      if (vao) {
        gl.deleteVertexArray(vao);
        vao = null;
      }
      if (vbo) {
        gl.deleteBuffer(vbo);
        vbo = null;
      }
      programsReady = false;
    }

    function resize() {
      if (!gl || !canvasEl) return;
      const rect = canvasEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const dpr = window.devicePixelRatio || 1;
      gridColumns = Math.max(
        BASE_GRID_COLUMNS,
        Math.round((rect.width / BASE_GRID_WIDTH_PX) * BASE_GRID_COLUMNS)
      );
      canvasEl.width = Math.round(rect.width * dpr);
      canvasEl.height = Math.round(rect.height * dpr);

      destroyFBOs();
      createFBOs();
    }

    function ensureLoop() {
      if (!simA || !simB) {
        resize();
        if (!simA || !simB) return;
      }
      if (loopRunning) {
        idleFrames = 0;
        return;
      }

      loopRunning = true;
      idleFrames = 0;
      wasActive = false;

      gl?.bindFramebuffer(gl.FRAMEBUFFER, simA.fbo);
      gl?.clear(gl.COLOR_BUFFER_BIT);
      gl?.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo);
      gl?.clear(gl.COLOR_BUFFER_BIT);

      rafId = requestAnimationFrame(render);
    }

    function render(t: number) {
      const active = isActiveRef.current;

      if (!active && !wasActive) {
        if (++idleFrames > MAX_IDLE) {
          loopRunning = false;
          rafId = null;
          return;
        }
        rafId = requestAnimationFrame(render);
        return;
      }

      idleFrames = 0;

      if (active && !wasActive) {
        gl?.bindFramebuffer(gl.FRAMEBUFFER, simA?.fbo ?? null);
        gl?.clear(gl.COLOR_BUFFER_BIT);
        gl?.bindFramebuffer(gl.FRAMEBUFFER, simB?.fbo ?? null);
        gl?.clear(gl.COLOR_BUFFER_BIT);
      }
      wasActive = active;

      if (!gl || !simA || !simB || !blurH || !blurV) return;

      const elapsed = active ? (performance.now() - (ultraStartRef.current || 0)) / 1000 : -1.0;
      const sv = sliderValueRef.current;

      gl.viewport(0, 0, canvasEl?.width ?? 0, canvasEl?.height ?? 0);

      gl.bindFramebuffer(gl.FRAMEBUFFER, simB.fbo);
      gl.useProgram(simProg);
      gl.uniform1f(U.simTime, t * 0.001);
      gl.uniform1f(U.simSlider, sv);
      gl.uniform1f(U.simElapsed, elapsed);
      gl.uniform1f(U.simGridX, gridColumns);
      gl.uniform3f(U.simEmber, ...themeFireColors.ember);
      gl.uniform3f(U.simGlow, ...themeFireColors.glow);
      gl.uniform3f(U.simCore, ...themeFireColors.core);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simA.tex);
      gl.uniform1i(U.simBack, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.useProgram(blurProg);
      gl.uniform2f(U.blurRes, canvasEl?.width ?? 0, canvasEl?.height ?? 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blurH.fbo);
      gl.uniform2f(U.blurDir, 1.0, 0.0);
      gl.uniform1f(U.blurExt, 1.0);
      gl.bindTexture(gl.TEXTURE_2D, simB.tex);
      gl.uniform1i(U.blurTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, blurV.fbo);
      gl.uniform2f(U.blurDir, 0.0, 1.0);
      gl.uniform1f(U.blurExt, 0.0);
      gl.bindTexture(gl.TEXTURE_2D, blurH.tex);
      gl.uniform1i(U.blurTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(compProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, simB.tex);
      gl.uniform1i(U.compScene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, blurV.tex);
      gl.uniform1i(U.compGlow, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      const tmp = simA;
      simA = simB;
      simB = tmp;

      rafId = requestAnimationFrame(render);
    }

    function init() {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('webgl2', {
        preserveDrawingBuffer: false,
        antialias: false,
      });
      if (!ctx) {
        console.warn('WebGL2 not supported');
        return;
      }

      gl = ctx;
      canvasEl = canvas;
      refreshThemeFireColors();
      canvas.addEventListener('webglcontextlost', onContextLost);
      canvas.addEventListener('webglcontextrestored', onContextRestored);
      themeObserver = new MutationObserver(refreshThemeFireColors);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'class', 'style'],
      });

      compilePrograms();
      if (!programsReady) return;

      resizeObserver = new ResizeObserver(() => {
        if (resizeDebounce) clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(resize, 80);
      });
      resizeObserver.observe(canvas);

      resize();
    }

    init();

    apiRef.current.ensureLoop = ensureLoop;
    // If the component already starts in the active state, kick off the
    // render loop now that WebGL is ready.
    if (isActiveRef.current) {
      ensureLoop();
    }

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (resizeDebounce) {
        clearTimeout(resizeDebounce);
        resizeDebounce = null;
      }
      if (themeObserver) {
        themeObserver.disconnect();
        themeObserver = null;
      }
      loopRunning = false;
      destroyFBOs();
      destroyPrograms();
      if (canvasEl) {
        canvasEl.removeEventListener('webglcontextlost', onContextLost);
        canvasEl.removeEventListener('webglcontextrestored', onContextRestored);
      }
      gl = null;
      canvasEl = null;
    };
  }, [canvasRef]);
}
