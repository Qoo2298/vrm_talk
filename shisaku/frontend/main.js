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

camera.position.set(0, 1.7, 1.5);

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

controls.target.set(0, 1.05, 0);

controls.enableDamping = true;

controls.dampingFactor = 0.08;

controls.minPolarAngle = Math.PI * 0.25;

controls.maxPolarAngle = Math.PI * 0.85;

controls.minDistance   = 0.8;

controls.maxDistance   = 3.5;

controls.update();

const CAM_SETTINGS_KEY = "vrm_cam_settings";

// 初期カメラ位置とターゲットを保存
let initialCameraPos = new THREE.Vector3();
let initialControlsTarget = new THREE.Vector3();
let hasCustomCameraSettings = false;

function saveCameraSettings() {
  const settings = {
    pos: camera.position.toArray(),
    tgt: controls.target.toArray(),
  };
  initialCameraPos.copy(camera.position);
  initialControlsTarget.copy(controls.target);
  localStorage.setItem(CAM_SETTINGS_KEY, JSON.stringify(settings));
  hasCustomCameraSettings = true;
}

function loadCameraSettings() {
  const savedSettings = localStorage.getItem(CAM_SETTINGS_KEY);
  hasCustomCameraSettings = Boolean(savedSettings);
  if (savedSettings) {
    try {
      const settings = JSON.parse(savedSettings);
      if (Array.isArray(settings.pos) && settings.pos.length === 3) {
        initialCameraPos.fromArray(settings.pos);
      } else {
        initialCameraPos.set(0, 1.7, 1.5);
      }
      if (Array.isArray(settings.tgt) && settings.tgt.length === 3) {
        initialControlsTarget.fromArray(settings.tgt);
      } else {
        initialControlsTarget.set(0, 1.05, 0);
      }
    } catch (e) {
      console.error("Failed to load camera settings, using defaults.", e);
      // デフォルト値にフォールバック
      initialCameraPos.set(0, 1.7, 1.5);
      initialControlsTarget.set(0, 1.05, 0);
      hasCustomCameraSettings = false;
    }
  } else {
    // 保存された設定がない場合は、現在のカメラ設定を初期値とする
    initialCameraPos.copy(camera.position);
    initialControlsTarget.copy(controls.target);
    hasCustomCameraSettings = false;
  }
  resetCameraToInitial();
}



function resetCameraToInitial() {

  camera.position.copy(initialCameraPos);

  controls.target.copy(initialControlsTarget);

  controls.update();

  updateCameraDebugPanel();

}

const cameraDebugPanel = document.getElementById("camera-debug-panel");
const camPos = { x: document.getElementById("cam-pos-x"), y: document.getElementById("cam-pos-y"), z: document.getElementById("cam-pos-z") };
const camTgt = { x: document.getElementById("cam-tgt-x"), y: document.getElementById("cam-tgt-y"), z: document.getElementById("cam-tgt-z") };
const cameraDistanceEl = document.getElementById("cam-dist-val");
const fixInitialCamBtn = document.getElementById("fixInitialCamBtn");
const resetCamBtn = document.getElementById("resetCamBtn");
const closeCameraSettingsBtn = document.getElementById("close-camera-settings");

const settingsToggleBtn = document.getElementById("settings-toggle");
const mainSettingsPanel = document.getElementById("main-settings-panel");
const openCameraSettingsBtn = document.getElementById("open-camera-settings");
const openLogModalBtn = document.getElementById("open-log-modal");
const openLayoutEditorBtn = document.getElementById("open-layout-editor");

function updateCameraDebugPanel() {
  if (!cameraDebugPanel || cameraDebugPanel.hidden) return;

  const pos = camera.position;
  const tgt = controls.target;

  if (camPos.x) camPos.x.value = pos.x.toFixed(3);
  if (camPos.y) camPos.y.value = pos.y.toFixed(3);
  if (camPos.z) camPos.z.value = pos.z.toFixed(3);

  if (camTgt.x) camTgt.x.value = tgt.x.toFixed(3);
  if (camTgt.y) camTgt.y.value = tgt.y.toFixed(3);
  if (camTgt.z) camTgt.z.value = tgt.z.toFixed(3);

  if (cameraDistanceEl) {
    const dist = pos.distanceTo(tgt);
    cameraDistanceEl.textContent = dist.toFixed(3);
  }
}

function updateCameraFromInputs() {
  const newPosX = parseFloat(camPos.x.value) || 0;
  const newPosY = parseFloat(camPos.y.value) || 0;
  const newPosZ = parseFloat(camPos.z.value) || 0;
  camera.position.set(newPosX, newPosY, newPosZ);

  const newTgtX = parseFloat(camTgt.x.value) || 0;
  const newTgtY = parseFloat(camTgt.y.value) || 0;
  const newTgtZ = parseFloat(camTgt.z.value) || 0;
  controls.target.set(newTgtX, newTgtY, newTgtZ);

  controls.update();
  updateCameraDebugPanel();
}

Object.values(camPos).forEach(el => el?.addEventListener("input", updateCameraFromInputs));
Object.values(camTgt).forEach(el => el?.addEventListener("input", updateCameraFromInputs));

if (fixInitialCamBtn) {
  fixInitialCamBtn.addEventListener("click", () => {
    saveCameraSettings();
    updateCameraDebugPanel();
    fixInitialCamBtn.textContent = "固定しました！";
    setTimeout(() => { fixInitialCamBtn.textContent = "初期位置を固定"; }, 1500);
  });
}

if (resetCamBtn) {
  resetCamBtn.addEventListener("click", resetCameraToInitial);
}

if (settingsToggleBtn) {
  settingsToggleBtn.addEventListener("click", () => {
    if (mainSettingsPanel) mainSettingsPanel.hidden = !mainSettingsPanel.hidden;
  });
}

if (openCameraSettingsBtn) {
  openCameraSettingsBtn.addEventListener("click", () => {
    if (cameraDebugPanel) cameraDebugPanel.hidden = false;
    if (mainSettingsPanel) mainSettingsPanel.hidden = true;
    updateCameraDebugPanel();
  });
}

if (closeCameraSettingsBtn) {
  closeCameraSettingsBtn.addEventListener("click", () => {
    if (cameraDebugPanel) cameraDebugPanel.hidden = true;
  });
}

if (openLayoutEditorBtn) {
  openLayoutEditorBtn.addEventListener("click", () => {
    if (mainSettingsPanel) mainSettingsPanel.hidden = true;
    enterLayoutEditMode();
  });
}

loadCameraSettings();



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
  if (hasCustomCameraSettings) {
    controls.update();
    return;
  }
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
  updateCameraDebugPanel();
});

window.addEventListener("orientationchange", () => {
  setTimeout(() => {
    updateCanvasSize();
    syncAutoMode();
    updateCameraDebugPanel();
  }, 200);
});

// controlsが変更されたときにデバッグパネルを更新
controls.addEventListener("change", () => {
  updateCameraDebugPanel();
});



/* ==========================

   レイアウト編集モード

========================== */

const layoutEditToggle = document.getElementById("layout-edit-toggle");
const layoutEditorPanel = document.getElementById("layout-editor-panel");
const layoutScaleInput = document.getElementById("layout-scale");
const layoutScaleValue = document.getElementById("layout-scale-value");
const layoutLeftInput = document.getElementById("layout-left");
const layoutTopInput = document.getElementById("layout-top");
const layoutWidthInput = document.getElementById("layout-width");
const layoutHeightInput = document.getElementById("layout-height");
const layoutResetCurrentBtn = document.getElementById("layout-reset-current");
const layoutResetAllBtn = document.getElementById("layout-reset-all");
const layoutSaveBtn = document.getElementById("layout-save");
const layoutEditorCloseBtn = document.getElementById("layout-editor-close");
const layoutEditorTargetLabel = document.getElementById("layout-editor-target");
const layoutEditorHeader = layoutEditorPanel ? layoutEditorPanel.querySelector(".layout-editor-header") : null;

const LAYOUT_STORAGE_KEY = "ui-layout-config-v1";
const MIN_LAYOUT_WIDTH = 140;
const MIN_LAYOUT_HEIGHT = 90;
const EDITABLE_UI_IDS = [
  "ui",
  "vrm-panel",
  "style-bar",
  "motion-bar",
  "chat-box",
  "chat-log",
  "motion-toggle",
  "log-toggle",
  "exit-panel",
  "camera-debug-panel"
];

const layoutDefaults = {};
const resizeHandles = new Map();
let layoutConfig = loadLayoutConfig();
let layoutEditMode = false;
let currentEditableEl = null;
let dragState = null;
let layoutEditorPanelDragState = null;

function cleanupLayoutEditorPanelDragListeners(){
  window.removeEventListener("pointermove", onLayoutEditorPanelDragMove);
  window.removeEventListener("pointerup", onLayoutEditorPanelDragEnd);
  window.removeEventListener("pointercancel", onLayoutEditorPanelDragEnd);
}

function onLayoutEditorPanelDragPointerDown(event){
  if (!layoutEditMode || !layoutEditorPanel || event.button !== 0) return;
  if (event.target.closest("button")) return;
  const rect = layoutEditorPanel.getBoundingClientRect();
  layoutEditorPanel.style.left = `${Math.round(rect.left)}px`;
  layoutEditorPanel.style.top = `${Math.round(rect.top)}px`;
  layoutEditorPanel.style.right = "auto";
  layoutEditorPanel.style.bottom = "auto";
  layoutEditorPanelDragState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: rect.left,
    startTop: rect.top,
  };
  cleanupLayoutEditorPanelDragListeners();
  layoutEditorHeader?.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", onLayoutEditorPanelDragMove);
  window.addEventListener("pointerup", onLayoutEditorPanelDragEnd);
  window.addEventListener("pointercancel", onLayoutEditorPanelDragEnd);
  event.preventDefault();
}

function onLayoutEditorPanelDragMove(event){
  if (!layoutEditorPanelDragState || event.pointerId !== layoutEditorPanelDragState.pointerId) return;
  const dx = event.clientX - layoutEditorPanelDragState.startX;
  const dy = event.clientY - layoutEditorPanelDragState.startY;
  const nextLeft = layoutEditorPanelDragState.startLeft + dx;
  const nextTop = layoutEditorPanelDragState.startTop + dy;
  layoutEditorPanel.style.left = `${Math.round(nextLeft)}px`;
  layoutEditorPanel.style.top = `${Math.round(nextTop)}px`;
}

function onLayoutEditorPanelDragEnd(event){
  if (!layoutEditorPanelDragState || event.pointerId !== layoutEditorPanelDragState.pointerId) return;
  layoutEditorHeader?.releasePointerCapture?.(layoutEditorPanelDragState.pointerId);
  cleanupLayoutEditorPanelDragListeners();
  layoutEditorPanelDragState = null;
}

function loadLayoutConfig() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    for (const id of Object.keys(parsed)) {
      const entry = parsed[id] || {};
      parsed[id] = {
        top: Number(entry.top) || 0,
        left: Number(entry.left) || 0,
        width: entry.width != null ? Number(entry.width) : null,
        height: entry.height != null ? Number(entry.height) : null,
        scale: entry.scale != null ? Number(entry.scale) : 1,
      };
    }
    return parsed;
  } catch (err) {
    console.warn("レイアウト情報の読み込みに失敗しました", err);
    return {};
  }
}

function saveLayoutConfig() {
  try {
    const serializable = {};
    for (const id of Object.keys(layoutConfig)) {
      const cfg = layoutConfig[id];
      if (!cfg) continue;
      updateDirtyFlag(id);
      if (!cfg.dirty) continue;
      serializable[id] = {
        top: cfg.top,
        left: cfg.left,
        width: cfg.width ?? null,
        height: cfg.height ?? null,
        scale: cfg.scale ?? 1,
      };
    }
    if (Object.keys(serializable).length) {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(serializable));
    } else {
      localStorage.removeItem(LAYOUT_STORAGE_KEY);
    }
  } catch (err) {
    console.warn("レイアウト情報の保存に失敗しました", err);
  }
}

function ensureLayoutConfig(el) {
  if (!el || !el.id) return null;
  const id = el.id;
  const rect = el.getBoundingClientRect();
  if (!layoutDefaults[id]) {
    const computed = window.getComputedStyle(el);
    layoutDefaults[id] = {
      top: rect.top,
      left: rect.left,
      width: null,
      height: null,
      scale: 1,
      baseWidth: rect.width,
      baseHeight: rect.height,
      baseTransform: computed.transform && computed.transform !== "none" ? computed.transform : "",
      baseTransformOrigin: computed.transformOrigin || "",
    };
  }

  if (!layoutConfig[id]) {
    layoutConfig[id] = { ...layoutDefaults[id] };
  }

  const cfg = layoutConfig[id];
  if (cfg.baseWidth == null) cfg.baseWidth = layoutDefaults[id].baseWidth;
  if (cfg.baseHeight == null) cfg.baseHeight = layoutDefaults[id].baseHeight;
  if (cfg.top == null) cfg.top = layoutDefaults[id].top;
  if (cfg.left == null) cfg.left = layoutDefaults[id].left;
  if (cfg.scale == null) cfg.scale = 1;
  if (cfg.baseTransform == null) cfg.baseTransform = layoutDefaults[id].baseTransform || "";
  if (cfg.baseTransformOrigin == null) cfg.baseTransformOrigin = layoutDefaults[id].baseTransformOrigin || "";
  if (cfg.dirty == null) cfg.dirty = false;
  updateDirtyFlag(id);
  return cfg;
}

function applyLayoutToElement(el, cfg) {
  if (!el || !cfg) return;
  const id = el.id;
  const style = el.style;
  style.position = "fixed";
  style.right = "auto";
  style.bottom = "auto";

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1920;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1080;
  const defaults = layoutDefaults[id] || {};
  const rect = el.getBoundingClientRect();
  const measuredWidth = rect.width || defaults.baseWidth || 0;
  const measuredHeight = rect.height || defaults.baseHeight || 0;
  const baseWidth = (cfg.width != null ? cfg.width : defaults.baseWidth != null ? defaults.baseWidth : measuredWidth) || 0;
  const baseHeight = (cfg.height != null ? cfg.height : defaults.baseHeight != null ? defaults.baseHeight : measuredHeight) || 0;
  const scale = cfg.scale ?? 1;
  const effectiveWidth = Math.max(0, baseWidth * scale);
  const effectiveHeight = Math.max(0, baseHeight * scale);

  if (Number.isFinite(cfg.left)) {
    const maxLeft = Math.max(0, viewportWidth - effectiveWidth);
    const clampedLeft = Math.min(Math.max(cfg.left, 0), maxLeft);
    cfg.left = clampedLeft;
    style.left = `${Math.round(clampedLeft)}px`;
  } else if (defaults.left != null) {
    style.left = `${Math.round(defaults.left)}px`;
  } else {
    style.removeProperty("left");
  }

  if (Number.isFinite(cfg.top)) {
    const maxTop = Math.max(0, viewportHeight - effectiveHeight);
    const clampedTop = Math.min(Math.max(cfg.top, 0), maxTop);
    cfg.top = clampedTop;
    style.top = `${Math.round(clampedTop)}px`;
  } else if (defaults.top != null) {
    style.top = `${Math.round(defaults.top)}px`;
  } else {
    style.removeProperty("top");
  }

  const baseTransform = cfg.baseTransform && cfg.baseTransform !== "none" ? cfg.baseTransform : "";
  const parts = [];
  if (baseTransform) parts.push(baseTransform);
  if (Math.abs(scale - 1) > 0.001) parts.push(`scale(${scale})`);
  if (parts.length) {
    style.transform = parts.join(" ");
  } else {
    style.removeProperty("transform");
  }

  if (Math.abs(scale - 1) > 0.001) {
    style.transformOrigin = "top left";
  } else if (cfg.baseTransformOrigin) {
    style.transformOrigin = cfg.baseTransformOrigin;
  } else {
    style.removeProperty("transform-origin");
  }

  if (cfg.width && cfg.width > 0) style.width = `${Math.round(cfg.width)}px`;
  else style.removeProperty("width");

  if (cfg.height && cfg.height > 0) style.height = `${Math.round(cfg.height)}px`;
  else style.removeProperty("height");
}

function updateDirtyFlag(id) {
  const cfg = layoutConfig[id];
  const defaults = layoutDefaults[id];
  if (!cfg) return;
  if (!defaults) {
    cfg.dirty = true;
    return;
  }
  const epsilon = 0.5;
  const scaleEpsilon = 0.01;
  const diffTop = Math.abs((cfg.top ?? 0) - (defaults.top ?? 0)) > epsilon;
  const diffLeft = Math.abs((cfg.left ?? 0) - (defaults.left ?? 0)) > epsilon;
  const diffWidth = (cfg.width ?? null) !== (defaults.width ?? null);
  const diffHeight = (cfg.height ?? null) !== (defaults.height ?? null);
  const diffScale = Math.abs((cfg.scale ?? 1) - (defaults.scale ?? 1)) > scaleEpsilon;
  cfg.dirty = diffTop || diffLeft || diffWidth || diffHeight || diffScale;
}

function captureOriginalInlineStyles(el) {
  if (!el || el.dataset.layoutOriginal) return;
  const record = {
    top: el.style.top || "",
    left: el.style.left || "",
    right: el.style.right || "",
    bottom: el.style.bottom || "",
    width: el.style.width || "",
    height: el.style.height || "",
    position: el.style.position || "",
    transform: el.style.transform || "",
    transformOrigin: el.style.transformOrigin || "",
  };
  el.dataset.layoutOriginal = JSON.stringify(record);
}

function restoreOriginalInlineStyles(el) {
  if (!el || !el.dataset.layoutOriginal) return;
  try {
    const record = JSON.parse(el.dataset.layoutOriginal);
    const props = ["top", "left", "right", "bottom", "width", "height", "position", "transform", "transformOrigin"];
    for (const prop of props) {
      const value = record[prop];
      if (value) {
        el.style[prop] = value;
      } else {
        el.style.removeProperty(prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
      }
    }
  } catch (err) {
    // ignore restore errors
  }
  delete el.dataset.layoutOriginal;
}

function applyStoredLayouts() {
  for (const id of Object.keys(layoutConfig)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const cfg = ensureLayoutConfig(el);
    if (!cfg) continue;
    applyLayoutToElement(el, cfg);
    updateDirtyFlag(id);
  }
}

function updateLayoutEditorInputs(cfg) {
  if (!layoutEditorPanel) return;
  if (!cfg || !currentEditableEl) {
    if (layoutEditorTargetLabel) layoutEditorTargetLabel.textContent = "なし";
    if (layoutScaleInput) layoutScaleInput.value = "1";
    if (layoutScaleValue) layoutScaleValue.textContent = "1.00";
    if (layoutLeftInput) { layoutLeftInput.value = ""; layoutLeftInput.placeholder = ""; }
    if (layoutTopInput) { layoutTopInput.value = ""; layoutTopInput.placeholder = ""; }
    if (layoutWidthInput) layoutWidthInput.value = "";
    if (layoutHeightInput) layoutHeightInput.value = "";
    return;
  }

  if (layoutEditorTargetLabel) layoutEditorTargetLabel.textContent = currentEditableEl.id;
  const defaults = layoutDefaults[currentEditableEl.id] || {};

  const scale = cfg.scale ?? 1;
  if (layoutScaleInput && document.activeElement !== layoutScaleInput) {
    layoutScaleInput.value = scale.toFixed(2);
  }
  if (layoutScaleValue) layoutScaleValue.textContent = scale.toFixed(2);

  if (layoutLeftInput && document.activeElement !== layoutLeftInput) {
    layoutLeftInput.value = Number.isFinite(cfg.left) ? Math.round(cfg.left) : "";
    if (defaults.left != null) layoutLeftInput.placeholder = Math.round(defaults.left);
  }
  if (layoutTopInput && document.activeElement !== layoutTopInput) {
    layoutTopInput.value = Number.isFinite(cfg.top) ? Math.round(cfg.top) : "";
    if (defaults.top != null) layoutTopInput.placeholder = Math.round(defaults.top);
  }

  if (layoutWidthInput && document.activeElement !== layoutWidthInput) {
    layoutWidthInput.value = cfg.width != null ? Math.round(cfg.width) : "";
    if (cfg.baseWidth) layoutWidthInput.placeholder = Math.round(cfg.baseWidth);
  }
  if (layoutHeightInput && document.activeElement !== layoutHeightInput) {
    layoutHeightInput.value = cfg.height != null ? Math.round(cfg.height) : "";
    if (cfg.baseHeight) layoutHeightInput.placeholder = Math.round(cfg.baseHeight);
  }
}

function setCurrentEditable(el) {
  if (currentEditableEl === el) {
    updateLayoutEditorInputs(el ? ensureLayoutConfig(el) : null);
    return;
  }
  if (currentEditableEl) currentEditableEl.classList.remove("layout-edit-selected");
  currentEditableEl = el || null;
  if (currentEditableEl) {
    currentEditableEl.classList.add("layout-edit-selected");
    const cfg = ensureLayoutConfig(currentEditableEl);
    updateLayoutEditorInputs(cfg);
  } else {
    updateLayoutEditorInputs(null);
  }
}

function attachResizeHandle(el) {
  if (!el || resizeHandles.has(el.id)) return;
  const handle = document.createElement("div");
  handle.className = "layout-resize-handle";
  handle.addEventListener("pointerdown", onResizePointerDown);
  el.appendChild(handle);
  resizeHandles.set(el.id, handle);
}

function detachResizeHandle(el) {
  if (!el) return;
  const handle = resizeHandles.get(el.id);
  if (handle) {
    handle.removeEventListener("pointerdown", onResizePointerDown);
    handle.remove();
    resizeHandles.delete(el.id);
  }
}

function enterLayoutEditMode() {
  if (layoutEditMode) return;
  layoutEditMode = true;
  document.body.classList.add("layout-editing");
  if (layoutEditorPanel) layoutEditorPanel.hidden = false;

  for (const id of EDITABLE_UI_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    captureOriginalInlineStyles(el);
    ensureLayoutConfig(el);
    el.dataset.layoutId = id;
    el.classList.add("layout-editable-target");
    el.addEventListener("pointerdown", onEditablePointerDown);
    attachResizeHandle(el);
  }

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  if (!currentEditableEl) {
    const firstId = EDITABLE_UI_IDS.find((candidate) => document.getElementById(candidate));
    if (firstId) setCurrentEditable(document.getElementById(firstId));
  } else {
    setCurrentEditable(currentEditableEl);
  }

}

function exitLayoutEditMode() {
  if (!layoutEditMode) return;
  layoutEditMode = false;
  document.body.classList.remove("layout-editing");
  if (layoutEditorPanel) layoutEditorPanel.hidden = true;

  for (const id of EDITABLE_UI_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const cfg = layoutConfig[id];
    if (cfg) updateDirtyFlag(id);
    el.removeEventListener("pointerdown", onEditablePointerDown);
    el.classList.remove("layout-editable-target", "layout-edit-selected");
    detachResizeHandle(el);
    if (!cfg || !cfg.dirty) {
      restoreOriginalInlineStyles(el);
      if (cfg) delete layoutConfig[id];
    } else {
      delete el.dataset.layoutOriginal;
    }
  }

  if (layoutEditorPanelDragState) {
    layoutEditorHeader?.releasePointerCapture?.(layoutEditorPanelDragState.pointerId);
    cleanupLayoutEditorPanelDragListeners();
    layoutEditorPanelDragState = null;
  }

  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);

  currentEditableEl = null;
  dragState = null;
  saveLayoutConfig();
}

function toggleLayoutEditMode() {
  if (layoutEditMode) exitLayoutEditMode();
  else enterLayoutEditMode();
}

function startDrag(type, el, event) {
  const cfg = ensureLayoutConfig(el);
  if (!cfg) return;
  setCurrentEditable(el);
  dragState = {
    type,
    el,
    id: el.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startTop: cfg.top,
    startLeft: cfg.left,
    startWidth: cfg.width ?? cfg.baseWidth ?? el.getBoundingClientRect().width,
    startHeight: cfg.height ?? cfg.baseHeight ?? el.getBoundingClientRect().height,
    startScale: cfg.scale ?? 1,
  };
  el.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function onEditablePointerDown(event) {
  if (!layoutEditMode || event.button !== 0) return;
  if (event.target.classList.contains("layout-resize-handle")) return;
  const el = event.currentTarget;
  startDrag("move", el, event);
}

function onResizePointerDown(event) {
  if (!layoutEditMode || event.button !== 0) return;
  const el = event.currentTarget?.parentElement;
  if (!el) return;
  startDrag("resize", el, event);
}

function onPointerMove(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const cfg = layoutConfig[dragState.id];
  if (!cfg) return;

  const deltaX = event.clientX - dragState.startX;
  const deltaY = event.clientY - dragState.startY;

  if (dragState.type === "move") {
    cfg.left = dragState.startLeft + deltaX;
    cfg.top = dragState.startTop + deltaY;
  } else if (dragState.type === "resize") {
    const scale = cfg.scale ?? 1;
    cfg.width = Math.max(MIN_LAYOUT_WIDTH, dragState.startWidth + deltaX / scale);
    cfg.height = Math.max(MIN_LAYOUT_HEIGHT, dragState.startHeight + deltaY / scale);
  }

  applyLayoutToElement(dragState.el, cfg);
  if (currentEditableEl && currentEditableEl.id === dragState.id) {
    updateLayoutEditorInputs(cfg);
  }
  updateDirtyFlag(dragState.id);
}

function onPointerUp(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  dragState.el.releasePointerCapture?.(dragState.pointerId);
  const cfg = layoutConfig[dragState.id];
  if (cfg) {
    applyLayoutToElement(dragState.el, cfg);
    saveLayoutConfig();
  }
  dragState = null;
}

function resetLayoutFor(id) {
  const defaults = layoutDefaults[id];
  const el = document.getElementById(id);
  if (!defaults || !el) return;
  layoutConfig[id] = { ...defaults };
  const cfg = ensureLayoutConfig(el);
  applyLayoutToElement(el, cfg);
  updateDirtyFlag(id);
  if (currentEditableEl && currentEditableEl.id === id) {
    updateLayoutEditorInputs(cfg);
  }
}

function registerLayoutEditorEvents() {
  if (layoutEditToggle) {
    layoutEditToggle.addEventListener("click", toggleLayoutEditMode);
  }
  if (layoutEditorHeader) {
    layoutEditorHeader.addEventListener("pointerdown", onLayoutEditorPanelDragPointerDown);
  }
  if (layoutEditorCloseBtn) {
    layoutEditorCloseBtn.addEventListener("click", exitLayoutEditMode);
  }
  if (layoutScaleInput) {
    layoutScaleInput.addEventListener("input", () => {
      if (!layoutEditMode || !currentEditableEl) return;
      const cfg = ensureLayoutConfig(currentEditableEl);
      const scale = parseFloat(layoutScaleInput.value);
      if (!Number.isFinite(scale)) return;
      cfg.scale = Math.min(2, Math.max(0.6, scale));
      applyLayoutToElement(currentEditableEl, cfg);
      updateLayoutEditorInputs(cfg);
      updateDirtyFlag(currentEditableEl.id);
    });
    layoutScaleInput.addEventListener("change", saveLayoutConfig);
  }

  if (layoutLeftInput) {
    layoutLeftInput.addEventListener("change", () => {
      if (!layoutEditMode || !currentEditableEl) return;
      const value = layoutLeftInput.value.trim();
      const cfg = ensureLayoutConfig(currentEditableEl);
      if (value === "") {
        const defaults = layoutDefaults[currentEditableEl.id];
        if (defaults && defaults.left != null) cfg.left = defaults.left;
      } else {
        const left = Number(value);
        if (Number.isFinite(left)) cfg.left = left;
      }
      applyLayoutToElement(currentEditableEl, cfg);
      updateLayoutEditorInputs(cfg);
      updateDirtyFlag(currentEditableEl.id);
      saveLayoutConfig();
    });
  }

  if (layoutTopInput) {
    layoutTopInput.addEventListener("change", () => {
      if (!layoutEditMode || !currentEditableEl) return;
      const value = layoutTopInput.value.trim();
      const cfg = ensureLayoutConfig(currentEditableEl);
      if (value === "") {
        const defaults = layoutDefaults[currentEditableEl.id];
        if (defaults && defaults.top != null) cfg.top = defaults.top;
      } else {
        const top = Number(value);
        if (Number.isFinite(top)) cfg.top = top;
      }
      applyLayoutToElement(currentEditableEl, cfg);
      updateLayoutEditorInputs(cfg);
      updateDirtyFlag(currentEditableEl.id);
      saveLayoutConfig();
    });
  }

  if (layoutWidthInput) {
    layoutWidthInput.addEventListener("change", () => {
      if (!layoutEditMode || !currentEditableEl) return;
      const value = layoutWidthInput.value.trim();
      const cfg = ensureLayoutConfig(currentEditableEl);
      if (value === "") {
        cfg.width = null;
      } else {
        const width = Number(value);
        if (Number.isFinite(width) && width >= MIN_LAYOUT_WIDTH) {
          cfg.width = width;
        }
      }
      applyLayoutToElement(currentEditableEl, cfg);
      updateLayoutEditorInputs(cfg);
      updateDirtyFlag(currentEditableEl.id);
      saveLayoutConfig();
    });
  }

  if (layoutHeightInput) {
    layoutHeightInput.addEventListener("change", () => {
      if (!layoutEditMode || !currentEditableEl) return;
      const value = layoutHeightInput.value.trim();
      const cfg = ensureLayoutConfig(currentEditableEl);
      if (value === "") {
        cfg.height = null;
      } else {
        const height = Number(value);
        if (Number.isFinite(height) && height >= MIN_LAYOUT_HEIGHT) {
          cfg.height = height;
        }
      }
      applyLayoutToElement(currentEditableEl, cfg);
      updateLayoutEditorInputs(cfg);
      updateDirtyFlag(currentEditableEl.id);
      saveLayoutConfig();
    });
  }

  if (layoutResetCurrentBtn) {
    layoutResetCurrentBtn.addEventListener("click", () => {
      if (!currentEditableEl) return;
      resetLayoutFor(currentEditableEl.id);
      saveLayoutConfig();
    });
  }

  if (layoutResetAllBtn) {
    layoutResetAllBtn.addEventListener("click", () => {
      for (const id of Object.keys(layoutDefaults)) {
        resetLayoutFor(id);
      }
      saveLayoutConfig();
      if (currentEditableEl) {
        updateLayoutEditorInputs(ensureLayoutConfig(currentEditableEl));
      } else {
        updateLayoutEditorInputs(null);
      }
    });
  }

  if (layoutSaveBtn) {
    layoutSaveBtn.addEventListener("click", () => {
      saveLayoutConfig();
    });
  }
}

function setupLayoutEditor() {
  applyStoredLayouts();
  registerLayoutEditorEvents();
}

setupLayoutEditor();


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

  motionBar.style.display = motionHidden ? 'none' : 'flex';

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

  position: fixed; right: 24px; top: 254px; z-index: 1200;

  background: rgba(0,0,0,0.65); color: #fff; padding: 8px 10px;

  border-radius: 8px; font-size: 12px; min-width: 280px; display: none;

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
  const vrmUploadBtn = document.getElementById("vrmUploadBtn");
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

  if (vrmUploadBtn) {
    vrmUploadBtn.addEventListener("click", () => {
      vrmInputEl.click(); // 隠されたファイル入力要素のクリックイベントをトリガー
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
