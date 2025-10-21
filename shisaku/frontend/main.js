import * as THREE from "three";

import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { VRMLoaderPlugin } from "@pixiv/three-vrm";

import {

  VRMAnimationLoaderPlugin,

  createVRMAnimationClip,

} from "@pixiv/three-vrm-animation";



/* ==========================

   Three.js 基本

========================== */

const canvas = document.getElementById("c");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

renderer.outputColorSpace = THREE.SRGBColorSpace;



const scene = new THREE.Scene();

scene.background = new THREE.Color(0xeeeeee);



const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.05, 100);

// 初期カメラを少し下げる（元 1.45 → 1.2）

camera.position.set(0, 1.2, 2.2);

const DISPLAY_MODE_CLASSES = ["auto", "pc", "mobile"];

function getDisplayMode() {
  if (document.body.classList.contains("pc")) return "pc";
  if (document.body.classList.contains("mobile")) return "mobile";
  return "auto";
}

function computeCanvasSize() {
  const mode = getDisplayMode();
  if (mode === "mobile") {
    const frame = document.getElementById("app-frame");
    const fallbackWidth = Math.min(window.innerWidth, 430);
    if (frame) {
      const rect = frame.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || fallbackWidth));
      const idealHeight = rect.height || width * 1.9;
      const height = Math.max(1, Math.round(Math.min(Math.max(idealHeight, width * 1.6), window.innerHeight || idealHeight)));
      return { width, height };
    }
    const width = Math.max(1, Math.round(fallbackWidth));
    const height = Math.max(1, Math.round(Math.min(width * 1.9, window.innerHeight || width * 1.9)));
    return { width, height };
  }
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

function updateCanvasSize() {
  const { width, height } = computeCanvasSize();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderer.setViewport(0, 0, width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  const mode = getDisplayMode();
  if (mode === "mobile") {
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.right = "0";
    canvas.style.bottom = "0";
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.margin = "0 auto";
  } else {
    canvas.style.position = "fixed";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.right = "0";
    canvas.style.bottom = "0";
    canvas.style.width = "100vw";
    canvas.style.height = "100vh";
    canvas.style.margin = "0";
  }
  canvas.style.transform = "";
  canvas.style.zIndex = "0";

  syncAutoMode();
}


updateCanvasSize();

function syncAutoMode() {
  const mode = getDisplayMode();
  if (mode !== "auto") {
    document.body.classList.toggle("is-mobile", mode === "mobile");
    document.documentElement.classList.toggle("is-mobile", mode === "mobile");
    return;
  }
  // 820px以下の場合はモバイルビューとみなす
  const isMobileView = window.innerWidth <= 820;
  document.body.classList.toggle("is-mobile", isMobileView);
  document.documentElement.classList.toggle("is-mobile", isMobileView);
}



const controls = new OrbitControls(camera, renderer.domElement);

// 初期ターゲットも少し下げる（元 1.35 → 1.15）

controls.target.set(0, 1.15, 0);

controls.enableDamping = true;

controls.dampingFactor = 0.08;

controls.minPolarAngle = Math.PI * 0.25;

controls.maxPolarAngle = Math.PI * 0.85;

controls.minDistance   = 1.2;

controls.maxDistance   = 3.5;

controls.update();



// 初期カメラ位置とターゲットを保存

const initialCameraPos    = camera.position.clone();

const initialControlsTarget = controls.target.clone();



function resetCameraToInitial() {

  camera.position.copy(initialCameraPos);

  controls.target.copy(initialControlsTarget);

  controls.update();

}



const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.85);

scene.add(hemi);

const ambient = new THREE.AmbientLight(0xffffff, 0.3);

scene.add(ambient);

const dir = new THREE.DirectionalLight(0xffffff, 1.0);

dir.position.set(1, 1.2, 0.8);

scene.add(dir);



/* ==========================

   VRM

========================== */

let vrm = null;

let clock = new THREE.Clock();



let headBone, chestBone, spineBone, hipsBone, leftArm, rightArm, leftHand, rightHand, leftLeg, rightLeg;



const getBone = (vrm, names) => {

  for (const n of names) {

    const b = vrm.humanoid?.getNormalizedBoneNode(n);

    if (b) return b;

  }

  return null;

};



const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

const DEFAULT_VRM_PATH = "./avatar.vrm";
let currentVRMLabel = "avatar.vrm";
let vrmStatusEl = null;
let vrmInputEl = null;
let vrmResetEl = null;

function setVRMStatus(text) {
  if (vrmStatusEl) vrmStatusEl.textContent = text;
}

function frameVRM(root) {
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // ターゲットだけはバウンディングに寄せる（視点は初期を維持）
    const targetY = center.y + size.y * 0.15;
    controls.target.set(center.x, targetY, center.z);
    controls.update();
  }
}

function removeCurrentVRM() {
  if (!vrm) return;
  stopMotion();
  if (mixer) {
    try { mixer.stopAllAction(); } catch (_) {}
    try { mixer.uncacheRoot?.(vrm.scene); } catch (_) {}
  }
  scene.remove(vrm.scene);
  try { vrm.dispose?.(); } catch (_) {}
  vrm = null;
  headBone = chestBone = spineBone = hipsBone = leftArm = rightArm = leftHand = rightHand = leftLeg = rightLeg = null;
  poseTimeline = null;
  poseActive = false;
  targetHeadYaw = 0;
}

function applyVRMInstance(nextVRM) {
  if (!nextVRM) return;
  removeCurrentVRM();

  vrm = nextVRM;
  scene.add(vrm.scene);
  vrm.scene.rotation.y = Math.PI;

  headBone  = getBone(vrm, ["head"]);
  chestBone = getBone(vrm, ["chest", "upperChest"]);
  spineBone = getBone(vrm, ["spine"]);
  hipsBone  = getBone(vrm, ["hips"]);
  leftArm   = getBone(vrm, ["leftUpperArm"]);
  rightArm  = getBone(vrm, ["rightUpperArm"]);
  leftHand  = getBone(vrm, ["leftHand"]);
  rightHand = getBone(vrm, ["rightHand"]);
  leftLeg   = getBone(vrm, ["leftUpperLeg"]);
  rightLeg  = getBone(vrm, ["rightUpperLeg"]);

  if (leftArm)  leftArm.rotation.z  = Math.PI / 2.2;
  if (rightArm) rightArm.rotation.z = -Math.PI / 2.2;

  resetMotionState();
  frameVRM(vrm.scene);
}

async function loadVRMFromURL(url, { label } = {}) {
  const displayLabel = label || url;
  setVRMStatus(`VRM読込中: ${displayLabel}`);

  let gltf;
  try {
    gltf = await new Promise((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });
  } catch (err) {
    setVRMStatus(`VRM読込失敗: ${displayLabel}`);
    throw err;
  }

  const nextVRM = gltf?.userData?.vrm;
  if (!nextVRM) {
    setVRMStatus(`VRM読込失敗: ${displayLabel}`);
    throw new Error("VRMデータが見つかりません");
  }

  applyVRMInstance(nextVRM);
  currentVRMLabel = displayLabel;
  setVRMStatus(`VRM: ${currentVRMLabel}`);
  return nextVRM;
}

async function loadVRMFromFile(file) {
  const objectURL = URL.createObjectURL(file);
  try {
    await loadVRMFromURL(objectURL, { label: file.name });
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}



/* ==========================

   口パク & Web Audio

========================== */

const audioEl = document.getElementById("replyAudio");

let audioCtx = null, analyser = null, dataArray = null, srcNode = null;



function ensureAudioGraph() {

  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  srcNode = audioCtx.createMediaElementSource(audioEl);

  analyser = audioCtx.createAnalyser();

  analyser.fftSize = 1024;

  dataArray = new Uint8Array(analyser.frequencyBinCount);

  srcNode.connect(analyser);

  analyser.connect(audioCtx.destination);

}



// Mobile audio unlock: resume AudioContext on first user interaction

let _audioUnlocked = false;

function _unlockAudioOnce(){

  try {

    ensureAudioGraph();

    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  } catch(_){}

  _audioUnlocked = true;

  window.removeEventListener('touchend', _unlockAudioOnce);

  window.removeEventListener('click', _unlockAudioOnce);

}

window.addEventListener('touchend', _unlockAudioOnce, { once: true, passive: true });

window.addEventListener('click', _unlockAudioOnce, { once: true });

function mouthFromAudio() {

  if (!vrm || !analyser || !dataArray) return;

  analyser.getByteTimeDomainData(dataArray);

  let sum = 0;

  for (let i = 0; i < dataArray.length; i++) {

    const v = (dataArray[i] - 128) / 128;

    sum += v * v;

  }

  const rms = Math.sqrt(sum / dataArray.length);

  const val = Math.min(1, rms * 6);

  if (vrm.expressionManager) {

    vrm.expressionManager.setValue("aa", val);

    vrm.expressionManager.update();

  }

}



/* ==========================

   処理インジケータ（元コメントを保持）

========================== */

// const processingEl = document.createElement("div");

// processingEl.id = "processing-indicator";

// processingEl.style.cssText = `

//   position: fixed; top: 50%; left: 50%;

//   transform: translate(-50%, -50%);

//   padding: 10px 14px; border-radius: 10px;

//   background: rgba(0,0,0,0.65); color: #fff;

//   font-size: 14px; z-index: 2000; display: none;

// `;

// processingEl.textContent = "処理中…";

// document.body.appendChild(processingEl);

// let isProcessing = false;

// function setProcessing(v) {

//   isProcessing = v;

//   processingEl.style.display = v ? "block" : "none";

// }



/* ==========================

   VRMA 再生 & 日本語ファイル名対応

========================== */

const VRMA_BASE = "/vrma";

const animLoader = new GLTFLoader();

animLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));



let mixer = null;

let currentClip = null;

let currentAction = null;

let motionDuration = 0;

let isPlayingMotion = false;



const ui = {

  select: document.getElementById("motionSelect"),

  play: document.getElementById("motionPlay"),

  stop: document.getElementById("motionStop"),

  loop: document.getElementById("motionLoop"),

  speed: document.getElementById("motionSpeed"),

  seek:  document.getElementById("motionSeek"),

  cur:   document.getElementById("motionCur"),

  dur:   document.getElementById("motionDur"),

};


function resetMotionState() {
  stopMotion();
  mixer = null;
  currentClip = null;
  currentAction = null;
  motionDuration = 0;
  isPlayingMotion = false;
  if (ui.seek) ui.seek.value = "0";
  if (ui.cur) ui.cur.textContent = "0.00";
  if (ui.dur) ui.dur.textContent = "0.00";
}



async function loadVRMA(name) {

  if (!vrm) throw new Error("VRM未ロードです");

  const url = `${VRMA_BASE}/${encodeURIComponent(name)}.vrma`;



  const gltf = await new Promise((resolve, reject) => {

    animLoader.load(url, resolve, undefined, reject);

  });



  const vrmAnimations = gltf.userData.vrmAnimations;

  if (!vrmAnimations || vrmAnimations.length === 0) {

    throw new Error("VRMAnimationが見つかりません");

  }

  const vrmAnimation = vrmAnimations[0];



  currentClip = createVRMAnimationClip(vrmAnimation, vrm);

  // 比較に使うため選択名を付与

  try { currentClip.name = name; } catch (_) {}

  motionDuration = currentClip.duration || 0;

  ui.dur.textContent = motionDuration.toFixed(2);



  if (!mixer) mixer = new THREE.AnimationMixer(vrm.scene);

  if (currentAction) {

    currentAction.stop();

    mixer.uncacheClip(currentClip);

  }

  currentAction = mixer.clipAction(currentClip);

  currentAction.clampWhenFinished = true;



  setLoop(ui.loop.checked);

  setSpeed(parseFloat(ui.speed.value));

  ui.seek.value = "0";

  ui.cur.textContent = "0.00";

}



function setLoop(on) {

  if (!currentAction) return;

  currentAction.setLoop(on ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);

}



function setSpeed(s) {

  if (mixer) mixer.timeScale = s;

}



function playMotion() {

  if (!currentAction) return;

  // 再生開始時にカメラを初期位置へ戻す

  resetCameraToInitial();



  isPlayingMotion = true;

  currentAction.reset();

  currentAction.play();

}



function stopMotion() {

  if (currentAction) currentAction.stop();

  if (mixer) mixer.stopAllAction();

  isPlayingMotion = false;

}



ui.play.addEventListener("click", async () => {

  try {

    const name = ui.select.value;

    if (!currentClip || currentClip.name !== name) {

      await loadVRMA(name);

    }

    playMotion();

  } catch (e) {

    console.error(e);

    alert("モーション読込に失敗しました: " + e.message);

  }

});



ui.stop.addEventListener("click", () => stopMotion());

ui.loop.addEventListener("change", () => setLoop(ui.loop.checked));

ui.speed.addEventListener("input", () => setSpeed(parseFloat(ui.speed.value)));



// 切り替え中に再生していたら、そのまま新モーションへスムーズに移行

ui.select.addEventListener("change", async () => {

  const name = ui.select.value;

  const wasPlaying = isPlayingMotion && currentAction && motionDuration > 0;

  try {

    await loadVRMA(name);

    if (wasPlaying && currentAction) {

      // 変更時は常に先頭から再生し直す

      currentAction.reset();

      currentAction.play();

      currentAction.time = 0;

      isPlayingMotion = true;

    }

  } catch (e) {

    console.error(e);

    alert("モーション切り替えに失敗しました: " + e.message);

  }

});



let isScrubbing = false;

ui.seek.addEventListener("input", () => {

  if (!mixer || !currentAction || !currentClip) return;

  isScrubbing = true;

  const t = parseFloat(ui.seek.value) * motionDuration;

  currentAction.paused = true;

  currentAction.time = t;

  mixer.setTime(t);

  ui.cur.textContent = t.toFixed(2);

});

ui.seek.addEventListener("change", () => {

  if (!currentAction) return;

  currentAction.paused = false;

  isScrubbing = false;

});



/* ==========================

   Gemini 駆動の「頭左右」だけポーズ

========================== */

// 目標角と現在角（Y回転のみ、rad）

let targetHeadYaw = 0;   // 目標

let currentHeadYaw = 0;  // 表示側

const HEAD_YAW_MIN = -0.6; // 左最大

const HEAD_YAW_MAX =  0.6; // 右最大

const HEAD_LERP    =  0.1; // スムージング係数（0〜1）





// Pose timeline state (driven by backend response)

let poseTimeline = null; // Array of [t(0..1), y]

let poseActive = false;

let poseListenersAttached = false;



function samplePoseTimeline(timeline, tNorm) {

  if (!Array.isArray(timeline) || timeline.length === 0) return 0;

  const t = Math.max(0, Math.min(1, Number(tNorm) || 0));

  let prev = timeline[0];

  let next = timeline[timeline.length - 1];

  for (let i = 0; i < timeline.length; i++) {

    const kp = timeline[i];

    if (kp[0] <= t) prev = kp;

    if (kp[0] >= t) { next = kp; break; }

  }

  const t0 = Number(prev[0]);

  const y0 = Number(prev[1]);

  const t1 = Number(next[0]);

  const y1 = Number(next[1]);

  if (t1 <= t0) return y0;

  const a = (t - t0) / (t1 - t0);

  return y0 + (y1 - y0) * a;

}



function ensurePoseListeners() {

  if (poseListenersAttached) return;

  audioEl.addEventListener("play", () => { if (poseTimeline) poseActive = true; });

  audioEl.addEventListener("ended", () => { poseActive = false; targetHeadYaw = 0; });

  poseListenersAttached = true;

}



function applyPoseFromResponse(data) {

  try {

    ensurePoseListeners();

    const tl = data?.pose?.head?.timeline;

    if (Array.isArray(tl) && tl.length > 0) {

      poseTimeline = tl

        .map((kp) => {

          const t = Math.max(0, Math.min(1, Number(kp?.[0]) || 0));

          const y = Math.max(HEAD_YAW_MIN, Math.min(HEAD_YAW_MAX, Number(kp?.[1]) || 0));

          return [t, y];

        })

        .sort((a, b) => a[0] - b[0]);

      poseActive = !audioEl.paused;

    } else {

      const y = Number(data?.pose?.head?.y);

      if (!Number.isNaN(y)) {

        const clamped = Math.max(HEAD_YAW_MIN, Math.min(HEAD_YAW_MAX, y));

        poseTimeline = [

          [0.0, 0.0],

          [0.25, clamped],

          [0.7, clamped * 0.6],

          [1.0, 0.0],

        ];

        poseActive = !audioEl.paused;

      }

    }

  } catch (_) {}

}



/* ==========================

   アニメーション & アイドル

========================== */

function animate() {

  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  const t = clock.getElapsedTime();



  if (mixer && !isScrubbing) mixer.update(delta);



  if (vrm) {

    if (!isPlayingMotion) {

      // 胸・腰・手足の微揺れ（既存）

      if (chestBone) chestBone.rotation.x = Math.sin(t * 1.2) * 0.03;

      if (hipsBone)  hipsBone.position.x  = Math.sin(t * 0.5) * 0.015;

      if (leftLeg)   leftLeg.rotation.x   = Math.sin(t * 0.6) * 0.02;

      if (rightLeg)  rightLeg.rotation.x  = -Math.sin(t * 0.6) * 0.02;

      if (leftArm)   leftArm.rotation.z   = Math.PI / 2.2 + Math.sin(t * 0.5) * 0.05;

      if (rightArm)  rightArm.rotation.z  = -Math.PI / 2.2 - Math.sin(t * 0.5) * 0.05;

      if (leftHand)  leftHand.rotation.x  = Math.sin(t * 1.2) * 0.05;

      if (rightHand) rightHand.rotation.x = -Math.sin(t * 1.2) * 0.05;



      // まばたき（既存）

      if (vrm.expressionManager) {

        const cycle = (t % 5) / 5;

        let blink = 0;

        if (cycle < 0.1) blink = cycle / 0.1;

        else if (cycle < 0.2) blink = 1;

        else if (cycle < 0.3) blink = 1 - (cycle - 0.2) / 0.1;

        vrm.expressionManager.setValue("blink", blink);

        vrm.expressionManager.update();

      }



      // Gemini からの頭Yawへスムーズに近づける

      // Drive head yaw from pose timeline when active

      if (poseActive && poseTimeline) {

        let tNorm = 0;

        if (!isNaN(audioEl.duration) && audioEl.duration > 0) {

          tNorm = Math.min(1, Math.max(0, audioEl.currentTime / audioEl.duration));

        } else {

          // Fallback: 2s segment loop

          tNorm = Math.min(1, (t % 2.0) / 2.0);

        }

        const y = samplePoseTimeline(poseTimeline, tNorm);

        targetHeadYaw = Math.max(HEAD_YAW_MIN, Math.min(HEAD_YAW_MAX, y));

      }

      if (headBone) {

        currentHeadYaw = currentHeadYaw + (targetHeadYaw - currentHeadYaw) * HEAD_LERP;

        headBone.rotation.y = currentHeadYaw;

      }

    }



    // 口パク

    if (!audioEl.paused) mouthFromAudio();



    // VRM の内部更新

    vrm.update?.(delta);

  }



  // シークUI更新

  if (mixer && currentAction && currentClip && !isScrubbing) {

    const tNow = currentAction.time % (motionDuration || 1);

    ui.cur.textContent = tNow.toFixed(2);

    ui.seek.value = motionDuration ? String(tNow / motionDuration) : "0";

  }



  controls.update();

  renderer.render(scene, camera);

}

animate();



window.addEventListener("resize", () => {
  updateCanvasSize();
  syncAutoMode();
});

window.addEventListener("orientationchange", () => {
  setTimeout(() => {
    updateCanvasSize();
    syncAutoMode();
  }, 200);
});



/* ==========================

   UI / 送受信（既存）

========================== */

const recBtn = document.getElementById("recBtn");

const stopBtn = document.getElementById("stopBtn");

const chatInput = document.getElementById("chat-input");

const chatSend = document.getElementById("chat-send");

const styleSelect = document.getElementById("styleSelect");

const chatEngineSelect = document.getElementById("chatEngineSelect");
const modeSelect = document.getElementById("modeSelect");

function applyDisplayMode(mode) {
  const bodyCls = document.body.classList;
  const htmlCls = document.documentElement.classList;
  const target = DISPLAY_MODE_CLASSES.includes(mode) ? mode : "auto";
  DISPLAY_MODE_CLASSES.forEach((c) => {
    bodyCls.remove(c);
    htmlCls.remove(c);
  });
  bodyCls.remove("is-mobile");
  htmlCls.remove("is-mobile");
  bodyCls.add(target);
  htmlCls.add(target);
  // 'auto' モード以外では is-mobile を手動で設定
  if (target === 'mobile') bodyCls.add('is-mobile');
  else if (target === 'pc') bodyCls.remove('is-mobile');

  updateCanvasSize();
  syncAutoMode();
  if (modeSelect && modeSelect.value !== target) {
    modeSelect.value = target;
  }
}

if (modeSelect) {
  modeSelect.addEventListener("change", (e) => {
    applyDisplayMode(e.target.value);
  });
  syncAutoMode();
  applyDisplayMode(modeSelect.value);
  syncAutoMode();
} else {
  const current = DISPLAY_MODE_CLASSES.find((c) => document.body.classList.contains(c)) || "auto";
  applyDisplayMode(current);
  syncAutoMode();
}

// Minimal conversation mode toggle (UI)

let minimalModeEl = document.getElementById("minimalMode");

if (!minimalModeEl && styleSelect) {

  const wrap = document.createElement('label');

  wrap.style.marginLeft = '8px';

  const cb = document.createElement('input');

  cb.type = 'checkbox';

  cb.id = 'minimalMode';

  minimalModeEl = cb;

  wrap.appendChild(cb);

  wrap.appendChild(document.createTextNode(' 最小会話'));

  // insert after styleSelect

  const parent = styleSelect.parentElement;

  if (parent) parent.appendChild(wrap);

}

const chatLog = document.getElementById("chat-log");

const logToggleBtn = document.getElementById("log-toggle");

const logModal = document.getElementById("log-modal");

const logList = document.getElementById("log-list");

const logCloseBtn = document.getElementById("log-close");

const autoTtsStatus = document.getElementById("autoTtsStatus");

const motionBar = document.getElementById("motion-bar");

const motionToggleBtn = document.getElementById("motion-toggle");

const unlockBtn = document.getElementById("unlockAudio");

const fullscreenBtn = document.getElementById("fullscreenToggle");

const settingsOpenBtn = document.getElementById("settings-open");

const settingsModal = document.getElementById("settings-modal");

const settingsCancelBtn = document.getElementById("settings-cancel");

const settingsSaveBtn = document.getElementById("settings-save");

const settingsChatEngine = document.getElementById("settings-chatEngine");

const settingsMotionVisible = document.getElementById("settings-motionVisible");



let motionHidden = false;

function updateMotionVisibility(){

  if (!motionBar || !motionToggleBtn) return;

  motionBar.style.display = motionHidden ? 'none' : 'block';

  motionToggleBtn.textContent = motionHidden ? 'モーション表示' : 'モーション隠す';

}

if (motionToggleBtn){

  motionToggleBtn.addEventListener('click', () => {

    motionHidden = !motionHidden;

    updateMotionVisibility();

  });

  updateMotionVisibility();

}



// 再生許可ボタン: AudioContext を作成/再開して非表示に

if (unlockBtn){

  unlockBtn.addEventListener('click', async () => {

    try {

      ensureAudioGraph();

      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();

    } catch(_){}

    unlockBtn.style.display = 'none';

  });

}



// 全画面切替: 入力以外のUIを隠してフルスクリーンに

let minimalUiActive = false;

function isFullscreen(){ return !!(document.fullscreenElement || document.webkitFullscreenElement); }

function setMinimalUi(on){

  minimalUiActive = !!on;

  document.body.classList.toggle('minimal-ui', minimalUiActive);

  if (fullscreenBtn) fullscreenBtn.textContent = minimalUiActive ? '戻す' : '全画面';

}

async function tryRequestFullscreen(){

  try {

    const el = document.documentElement;

    if (el.requestFullscreen) await el.requestFullscreen();

    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();

  } catch(_){}

}

async function tryExitFullscreen(){

  try {

    if (document.exitFullscreen) await document.exitFullscreen();

    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();

  } catch(_){}

}

async function enterMinimal(){ setMinimalUi(true); await tryRequestFullscreen(); }

async function exitMinimal(){ setMinimalUi(false); await tryExitFullscreen(); }

if (fullscreenBtn){

  fullscreenBtn.addEventListener('click', async () => {

    if (minimalUiActive) await exitMinimal(); else await enterMinimal();

  });

}

document.addEventListener('fullscreenchange', () => { if (!isFullscreen() && minimalUiActive) setMinimalUi(false); });



// 最小UI時のタイマー表示/非表示

const timerToggleBtn = document.getElementById('timer-toggle');

let timerHidden = false;

function updateTimerVisibility(){

  const panel = document.getElementById('progress-panel');

  if (!panel || !timerToggleBtn) return;

  panel.style.display = timerHidden ? 'none' : 'block';

  timerToggleBtn.textContent = timerHidden ? 'タイマー表示' : 'タイマー非表示';

}

if (timerToggleBtn){

  timerToggleBtn.addEventListener('click', () => { timerHidden = !timerHidden; updateTimerVisibility(); });

}



// 設定モーダル: モードとモーション表示

function openSettings(){

  if (!settingsModal) return;

  if (settingsChatEngine && chatEngineSelect) settingsChatEngine.value = chatEngineSelect.value;

  if (settingsMotionVisible) settingsMotionVisible.checked = !motionHidden;

  settingsModal.style.display = 'flex';

}

function closeSettings(){ if (settingsModal) settingsModal.style.display = 'none'; }

if (settingsOpenBtn) settingsOpenBtn.addEventListener('click', openSettings);

if (settingsCancelBtn) settingsCancelBtn.addEventListener('click', closeSettings);

if (settingsModal) settingsModal.addEventListener('click', (e)=>{ if (e.target === settingsModal) closeSettings(); });

if (settingsSaveBtn){

  settingsSaveBtn.addEventListener('click', ()=>{

    if (settingsChatEngine && chatEngineSelect) chatEngineSelect.value = settingsChatEngine.value;

    if (settingsMotionVisible){ motionHidden = !settingsMotionVisible.checked; updateMotionVisibility(); }

    closeSettings();

  });

}



// 進行状況パネル（経過時間 + 現在処理）

const progressPanel = document.createElement('div');

progressPanel.id = 'progress-panel';

progressPanel.style.cssText = `

  position: fixed; right: 10px; top: 110px; z-index: 1200;

  background: rgba(0,0,0,0.65); color: #fff; padding: 8px 10px;

  border-radius: 8px; font-size: 12px; min-width: 160px; display: none;

`;

const progressStage = document.createElement('div');

const progressTimer = document.createElement('div');

progressPanel.appendChild(progressStage);

progressPanel.appendChild(progressTimer);

document.body.appendChild(progressPanel);

let progressTimerId = null;

let progressStartAt = 0;

function progressStart(stageText){

  progressStage.textContent = `処理: ${stageText}`;

  progressStartAt = performance.now();

  progressPanel.style.display = 'block';

  if (progressTimerId) clearInterval(progressTimerId);

  progressTimerId = setInterval(()=>{

    const ms = performance.now() - progressStartAt;

    progressTimer.textContent = `経過: ${(ms/1000).toFixed(2)}s`;

  }, 100);

}

function progressStageSet(stageText){ progressStage.textContent = `処理: ${stageText}`; }

function progressMarkReceived(){

  const ms = performance.now() - progressStartAt;

  progressTimer.textContent = `受信: ${(ms/1000).toFixed(2)}s`;

}

function progressFinish(finalText='完了', hideDelayMs=1800){

  progressStage.textContent = `処理: ${finalText}`;

  if (progressTimerId){ clearInterval(progressTimerId); progressTimerId=null; }

  const ms = performance.now() - progressStartAt;

  progressTimer.textContent = `Total: ${(ms/1000).toFixed(2)}s`;

  // Keep panel visible to show final elapsed time

}



const chatHistory = [];

function addChatLog(role, text) {

  chatHistory.push({ role, text });

  if (chatLog) {

    // 画面上には最新のみ（重ねない）

    chatLog.textContent = `${role}: ${text}`;

  }

}



function renderLogList() {

  if (!logList) return;

  logList.innerHTML = "";

  for (const item of chatHistory) {

    const div = document.createElement('div');

    div.className = 'item';

    const r = document.createElement('span');

    r.className = 'role';

    r.textContent = item.role;

    const t = document.createElement('span');

    t.className = 'text';

    t.textContent = item.text;

    div.appendChild(r);

    div.appendChild(t);

    logList.appendChild(div);

  }

}



if (logToggleBtn) {

  logToggleBtn.addEventListener('click', () => {

    renderLogList();

    if (logModal) logModal.style.display = 'flex';

  });

}

if (logCloseBtn) {

  logCloseBtn.addEventListener('click', () => {

    if (logModal) logModal.style.display = 'none';

  });

}

if (logModal) {

  logModal.addEventListener('click', (e) => {

    if (e.target === logModal) logModal.style.display = 'none';

  });

}



function updateModeStatusManual() {

  const opt = styleSelect.options[styleSelect.selectedIndex];

  autoTtsStatus.textContent = `System: 手動モード中 -> ${opt.text}`;

}

function updateModeStatusAuto(tts) {

  if (tts) {

    const sp = (tts.speedScale !== undefined) ? tts.speedScale : "1.0";

    const pi = (tts.pitchScale !== undefined) ? tts.pitchScale : "0.0";

    autoTtsStatus.textContent = `System: Auto TTS -> styleId:${tts.styleId}, speed:${sp}, pitch:${pi}`;

  } else {

    autoTtsStatus.textContent = "System: Auto TTS 無効";

  }

}



styleSelect.addEventListener("change", () => {

  if (styleSelect.value === "auto") autoTtsStatus.textContent = "System: Auto TTS 待機中";

  else updateModeStatusManual();

});

if (styleSelect.value === "auto") autoTtsStatus.textContent = "System: Auto TTS 待機中";

else updateModeStatusManual();



let recording = false;

let mediaRecorder = null;
let activeStream = null;

let chunks = [];



/* ---------- 録音 ---------- */

if (!recBtn || !stopBtn) {
  console.warn("record controls missing");
} else {
  recBtn.onclick = async () => {
    if (recording) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      addChatLog("System", "Recording is not available in this browser (HTTPS required).");
      return;
    }

    recBtn.disabled = true;
    stopBtn.disabled = true;
    recBtn.textContent = "Preparing mic...";

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error("record start error", err);
      addChatLog("System", "Could not access the microphone. Check browser permissions and HTTPS connection.");
      recBtn.disabled = false;
      stopBtn.disabled = true;
      recBtn.textContent = "Start Recording";
      recording = false;
      return;
    }

    activeStream = stream;
    recording = true;
    stopBtn.disabled = false;
    recBtn.textContent = "Recording...";

    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus" : "audio/webm";

    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    chunks = [];

    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    mediaRecorder.onstop = async () => {
      stopBtn.disabled = true;
      recBtn.disabled = false;
      recBtn.textContent = "Start Recording";
      recording = false;

      if (activeStream) {
        try {
          activeStream.getTracks().forEach((track) => track.stop());
        } catch (_) {
          // ignore
        } finally {
          activeStream = null;
        }
      }

      try {
        addChatLog("System", "Processing...");
        progressStart("Processing...");

        const blob = new Blob(chunks, { type: mime });
        const form = new FormData();
        form.append("file", blob, "input.webm");
        if (chatEngineSelect) form.append("chatEngine", chatEngineSelect.value);

        const minimalOn = !!(minimalModeEl && minimalModeEl.checked);
        if (!minimalOn) {
          if (styleSelect.value === "auto") form.append("autoMode", "1");
          else form.append("styleId", styleSelect.value);
        } else {
          if (styleSelect.value !== "auto") form.append("styleId", styleSelect.value);
          form.append("minimalMode", "1");
        }

        const res = await fetch("/api/voice", { method: "POST", body: form });
        const data = await res.json();
        progressMarkReceived();

        if (data.error) {
          addChatLog("System", data.error);
        } else {
          addChatLog("あなた", data.stt || "(voice input)");
          addChatLog("AI", data.text);
          renderSteps(data.steps || []);
          progressStageSet("Preparing TTS");

          if (minimalModeEl && minimalModeEl.checked) {
            poseTimeline = null;
            poseActive = false;
            targetHeadYaw = 0;
          } else {
            applyPoseFromResponse(data);
          }

          const audioListV = Array.isArray(data.audio) ? data.audio : (data.audio ? [data.audio] : []);
          ensureAudioGraph();

          if (audioListV.length === 0) {
            progressFinish("No audio");
          } else {
            const onReadyV = () => {
              progressFinish("Ready");
              audioEl.removeEventListener("canplaythrough", onReadyV);
            };
            audioEl.addEventListener("canplaythrough", onReadyV);
            progressStageSet("Playing audio");

            for (const src of audioListV) {
              audioEl.pause();
              audioEl.currentTime = 0;
              audioEl.src = src;
              await new Promise((resolve) => {
                const onEnded = () => {
                  audioEl.removeEventListener("ended", onEnded);
                  resolve();
                };
                audioEl.addEventListener("ended", onEnded);
                audioEl.play().catch(() => {
                  audioEl.removeEventListener("ended", onEnded);
                  resolve();
                });
              });
            }
          }

          if (data.auto) updateModeStatusAuto(data.tts);
          else updateModeStatusManual();
        }
      } catch (e) {
        console.error("voiceToReply error", e);
        addChatLog("System", "Error: " + e);
        progressFinish("Error");
      }
    };

    mediaRecorder.start();
  };

  stopBtn.onclick = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  };
}
/* ---------- テキスト送信 ---------- */

async function sendTextMessage(msg) {

  if (chatInput) chatInput.disabled = true;
  if (chatSend) {
    chatSend.disabled = true;
    chatSend.textContent = "\u9001\u4fe1\u4e2d...";
  }

  try {

    progressStart("Processing...");

    addChatLog("System", "Processing...");



    const form = new FormData();

    form.append("text", msg);

      if (chatEngineSelect) form.append("chatEngine", chatEngineSelect.value);

      const minimalOnT = !!(minimalModeEl && minimalModeEl.checked);

      if (!minimalOnT) {

        if (styleSelect.value === "auto") form.append("autoMode", "1");

        else form.append("styleId", styleSelect.value);

      } else {

        if (styleSelect.value !== "auto") form.append("styleId", styleSelect.value);

        form.append("minimalMode", "1");

      }



    const res = await fetch("/api/text", { method: "POST", body: form });

    const data = await res.json();

    progressMarkReceived();



    if (data.error) {
      addChatLog("System", data.error);
    } else {
      addChatLog("あなた", msg);
      addChatLog("AI", data.text);

      renderSteps(data.steps || []);
      progressStageSet("Preparing TTS");

      if (minimalModeEl && minimalModeEl.checked) {
        poseTimeline = null;
        poseActive = false;
        targetHeadYaw = 0;
      } else {
        applyPoseFromResponse(data);
      }

      const audioListT = Array.isArray(data.audio) ? data.audio : (data.audio ? [data.audio] : []);
      ensureAudioGraph();

      if (audioListT.length === 0) {
        progressFinish("No audio");
      } else {
        const onReadyT = () => {
          progressFinish("Ready");
          audioEl.removeEventListener("canplaythrough", onReadyT);
        };
        audioEl.addEventListener("canplaythrough", onReadyT);
        progressStageSet("Playing audio");

        for (const src of audioListT) {
          audioEl.pause();
          audioEl.currentTime = 0;
          audioEl.src = src;
          await new Promise((resolve) => {
            const onEnded = () => {
              audioEl.removeEventListener("ended", onEnded);
              resolve();
            };
            audioEl.addEventListener("ended", onEnded);
            audioEl.play().catch(() => {
              audioEl.removeEventListener("ended", onEnded);
              resolve();
            });
          });
        }
      }

      if (data.auto) updateModeStatusAuto(data.tts);
      else updateModeStatusManual();
    }
  } catch (e) {

    console.error("sendTextMessage error", e);
    addChatLog("System", "Error: " + e);
    progressFinish("Error");

  } finally {

    if (chatInput) chatInput.disabled = false;

    if (chatSend) {
      chatSend.disabled = false;
      chatSend.textContent = "\u9001\u4fe1";
    }

  }


}
document.getElementById("chat-send").onclick = async () => {

  const v = chatInput.value.trim();

  if (!v) return;

  chatInput.value = "";

  await sendTextMessage(v);

};

chatInput.addEventListener("keydown", async (e) => {

  if (e.key === "Enter" && !e.isComposing) {

    e.preventDefault();

    const v = chatInput.value.trim();

    if (!v) return;

    chatInput.value = "";

    await sendTextMessage(v);

  }

});
function setupVRMControls() {
  vrmStatusEl = document.getElementById("vrmStatus");
  vrmInputEl = document.getElementById("vrmInput");
  vrmResetEl = document.getElementById("vrmReset");
  setVRMStatus(`VRM: ${currentVRMLabel}`);

  if (vrmInputEl) {
    vrmInputEl.addEventListener("change", async (event) => {
      const input = event.target;
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        await loadVRMFromFile(file);
      } catch (err) {
        console.error("VRM load failed", err);
        alert("VRMの読み込みに失敗しました: " + (err?.message || err));
        setVRMStatus(`VRM読込失敗: ${file.name}`);
      } finally {
        input.value = "";
      }
    });
  }

  if (vrmResetEl) {
    vrmResetEl.addEventListener("click", async () => {
      try {
        await loadVRMFromURL(DEFAULT_VRM_PATH, { label: "avatar.vrm" });
      } catch (err) {
        console.error("Default VRM load failed", err);
        alert("デフォルトVRMの読み込みに失敗しました: " + (err?.message || err));
      }
    });
  }
}

async function initializeVRMHandling() {
  setupVRMControls();
  try {
    await loadVRMFromURL(DEFAULT_VRM_PATH, { label: currentVRMLabel });
  } catch (err) {
    console.error("初期VRMの読み込みに失敗しました", err);
    alert("VRMの初期読み込みに失敗しました: " + (err?.message || err));
  }
}

initializeVRMHandling();
















function renderSteps(steps) {
  try {
    const box = document.getElementById("proc-steps");
    if (!box) return;
    if (!steps || !steps.length) {
      box.textContent = "";
      return;
    }
    box.innerHTML =
      '<div style="font-weight:bold; margin-bottom:4px;">処理ステータス</div>' +
      steps.map((s, i) => `<div>${i + 1}. ${s}</div>`).join("");
  } catch (err) {
    // ignore render errors
  }
}
