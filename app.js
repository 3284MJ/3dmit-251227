import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- Global Variables ---
window.params = { walkSpeed: 0.06, dashSpeed: 0.12 };

// --- UI Logic ---
const helpContent = [
    { title: "歩いて移動", icon: "👆", desc: "地面を【1回タップ】" },
    { title: "ダッシュ移動", icon: "👆👆", desc: "地面を【2回連打】" },
    { title: "リフティング開始", icon: "⚽", desc: "ミツハシくんを【ダブルタップ】" },
    { title: "特殊アクション", icon: "✨", desc: "リフティング中に【ダブルタップ】" }
];

window.isModalOpen = false;
window.openHelpMenu = () => { window.isModalOpen = true; document.getElementById('help-modal').style.display = 'flex'; showList(); };
window.closeModal = () => { window.isModalOpen = false; document.getElementById('help-modal').style.display = 'none'; };
window.showList = () => {
    const listEl = document.getElementById('menu-list');
    const detailEl = document.getElementById('detail-area');
    const titleEl = document.getElementById('modal-title');
    detailEl.style.display = 'none'; listEl.style.display = 'flex'; listEl.style.flexDirection = 'column'; listEl.style.gap = '8px';
    titleEl.innerText = '操作説明メニュー'; listEl.innerHTML = '';
    helpContent.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'help-list-item';
        div.innerHTML = `${item.title} <span>▶</span>`;
        div.onclick = () => {
            listEl.style.display = 'none'; detailEl.style.display = 'block'; titleEl.innerText = item.title;
            document.getElementById('detail-content').innerHTML = `<span class="detail-icon">${item.icon}</span><div>${item.desc}</div>`;
        };
        listEl.appendChild(div);
    });
};

window.isDebugOpen = false;
window.openDebug = () => { if (window.isModalOpen) return; window.isDebugOpen = true; document.getElementById('debug-panel').style.display = 'block'; };
window.closeDebug = () => { window.isDebugOpen = false; document.getElementById('debug-panel').style.display = 'none'; };
window.updateParam = (key, val) => {
    const num = parseFloat(val);
    if (key === 'walk') { window.params.walkSpeed = num; document.getElementById('val-walk').innerText = num.toFixed(2); }
    else if (key === 'dash') { window.params.dashSpeed = num; document.getElementById('val-dash').innerText = num.toFixed(2); }
};

// --- Three.js Setup ---
const statusEl = document.getElementById('status-log');
function debugLog(msg) { console.log(msg); }

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe0e0e0);
scene.fog = new THREE.Fog(0xe0e0e0, 10, 50);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
const DEFAULT_CAM_POS = new THREE.Vector3(0, 6, 12);
camera.position.set(0, 5, 10); 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
dirLight.position.set(5, 10, 5);
dirLight.castShadow = true;
scene.add(dirLight);

const ground = new THREE.Mesh(
    new THREE.CircleGeometry(15, 64),
    new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// --- Core Variables ---
let mixer, model, blobShadow, flag;
let activeAction = null; 

// Animation Roles
let animNeutral   = null; // [0] 待機
let animSwing     = null; // [1] スイング (オープニングで使用)
let animJump      = null; // [2] ジャンプ
let animRun       = null; // [3] 走行
let animPick      = null; // [4] アイテム拾い
let animLiftStart = null; // [5] リフティング開始 (5a)
let animLiftLoop  = null; // [6] リフティングループ (5b)
let animLiftEnd   = null; // [7] リフティング終了 (5c)

let isLiftingLoop = false;

let idleTimer = null;
let isProcessing = false, isMoving = false, isBoostMode = false, isOpening = true, isDragging = false;
let lastTapTime = 0, tapStreak = 0, tapResetTimer = null;
let pointerDownPos = new THREE.Vector2();
const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.1;
controls.enabled = false;

// --- Helpers ---
function createShadow() {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.01;
    return mesh;
}
blobShadow = createShadow(); scene.add(blobShadow);

function createFlag() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1), new THREE.MeshStandardMaterial({ color: 0x888888 }));
    pole.position.y = 0.5;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.02), new THREE.MeshStandardMaterial({ color: 0xff4757 }));
    cloth.position.set(0.2, 0.8, 0); cloth.castShadow = true;
    g.add(pole, cloth); g.visible = false;
    return g;
}
flag = createFlag(); scene.add(flag);

// --- Initialization ---
const modelUrl = './model.glb?v=' + Date.now();

new GLTFLoader().load(modelUrl, (gltf) => {
    model = gltf.scene;
    model.traverse(c => { if(c.isMesh) c.castShadow = true; });
    scene.add(model);
    
    mixer = new THREE.AnimationMixer(model);
    const actionList = [];
    
    gltf.animations.forEach((clip) => {
        const action = mixer.clipAction(clip);
        actionList.push(action);
    });

    addAnimListToDebugMenu(gltf.animations);

    // 割り当て
    if (actionList[0]) animNeutral   = actionList[0];
    if (actionList[1]) animSwing     = actionList[1];
    if (actionList[2]) animJump      = actionList[2];
    if (actionList[3]) animRun       = actionList[3];
    if (actionList[4]) animPick      = actionList[4];
    if (actionList[5]) animLiftStart = actionList[5];
    if (actionList[6]) animLiftLoop  = actionList[6];
    if (actionList[7]) animLiftEnd   = actionList[7];

    if (!animNeutral) animNeutral = actionList[0];

    // 基本設定
    if (animNeutral) animNeutral.setLoop(THREE.LoopRepeat);
    if (animRun)     animRun.setLoop(THREE.LoopRepeat);
    if (animLiftLoop) animLiftLoop.setLoop(THREE.LoopRepeat);
    
    // ワンショット設定
    const setOnce = (act) => {
        if(act) { act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; }
    };
    setOnce(animJump);
    setOnce(animPick);
    // Swing, LiftStart, LiftEnd等は使用時に設定を上書きすることがあるためここでは初期設定

    runOpeningSequence();
});

function addAnimListToDebugMenu(animations) {
    const debugPanel = document.getElementById('debug-panel');
    const oldList = document.getElementById('debug-anim-list');
    if (oldList) oldList.remove();

    const section = document.createElement('div');
    section.id = 'debug-anim-list';
    section.className = 'debug-section';
    section.style.marginTop = '15px';
    section.style.borderTop = '1px dashed #00ffcc';
    section.style.paddingTop = '10px';

    const label = document.createElement('div');
    label.className = 'debug-label';
    label.innerText = 'ANIMATION LIST';
    section.appendChild(label);

    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = '0';
    ul.style.margin = '0';
    ul.style.fontSize = '11px';
    ul.style.color = '#fff';
    ul.style.maxHeight = '150px';
    ul.style.overflowY = 'auto';

    animations.forEach((clip, i) => {
        const li = document.createElement('li');
        li.textContent = `[${i}] : ${clip.name}`;
        li.style.padding = '2px 0';
        li.style.borderBottom = '1px solid #444';
        ul.appendChild(li);
    });

    section.appendChild(ul);
    const closeBtn = debugPanel.querySelector('.btn-close');
    debugPanel.insertBefore(section, closeBtn);
}

// --- Actions ---

// 1. オープニング
async function runOpeningSequence() {
    debugLog("Opening...");
    model.position.set(0, 0, -12);
    model.rotation.set(0, 0, 0);
    camera.position.set(0, 1.5, 4);
    controls.target.set(0, 0.8, -12); controls.update();
    
    // ★変更: actionList[1] (Swing) をループ再生
    const startAnim = animSwing || animNeutral;
    if(startAnim) {
        startAnim.setLoop(THREE.LoopRepeat); // ループ設定に強制
        startAnim.reset().play(); 
        activeAction = startAnim;
    }
    
    await new Promise(r => setTimeout(r, 2000));
    
    const pop = document.getElementById('emote-pop'); 
    pop.style.display = 'block'; updateEmotePosition();
    await new Promise(r => setTimeout(r, 1000)); pop.style.display = 'none';
    
    await fadeTo(animRun, 0.2); 
    isMoving = true;
    while (model.position.z < -2.0) { 
        model.position.z += 0.15; 
        controls.target.set(0, 0.8, model.position.z); 
        controls.update(); 
        await new Promise(r => requestAnimationFrame(r)); 
    }
    isMoving = false;
    
    // 終了 -> Neutral
    await fadeTo(animNeutral, 0.3);

    controls.target.set(0, 0.5, -2); 
    controls.update();

    isOpening = false; 
    controls.enabled = true; 
    resetIdleTimer(); 
}

function resetIdleTimer() { 
    if (idleTimer) clearTimeout(idleTimer); 
}

// --- リフティング制御 ---

// 開始: 5a -> 5b (Loop)
async function startLiftingSequence() {
    if (isProcessing || isMoving || !animLiftStart || !animLiftLoop) return;
    debugLog("Start Lifting");
    isProcessing = true;
    resetIdleTimer();

    // 1. 5a (Start)
    animLiftStart.setLoop(THREE.LoopOnce);
    animLiftStart.clampWhenFinished = true;
    await fadeTo(animLiftStart, 0.2);
    
    const duration = animLiftStart.getClip().duration;
    await new Promise(r => setTimeout(r, duration * 1000));

    // 2. 5b (Loop)
    if (activeAction === animLiftStart && !isMoving) { 
        animLiftLoop.setLoop(THREE.LoopRepeat); // 念のためループ設定
        await fadeTo(animLiftLoop, 0.1);
        isLiftingLoop = true;
        isProcessing = false; 
        debugLog("Lifting Loop...");
    } else {
        isProcessing = false;
    }
}

// ★変更: リフティング中の特殊アクション
// 5a (1回) -> 1秒停止 -> 5b (1回) -> Neutral
async function stopLiftingSequence() {
    // 必要なアニメーションがあるか確認
    if (isMoving || !animLiftStart || !animLiftLoop) return;
    
    debugLog("Special Action from Lifting");
    isProcessing = true; 
    isLiftingLoop = false; // ループ状態解除

    // 1. 5a (Start) を1回再生
    animLiftStart.setLoop(THREE.LoopOnce);
    animLiftStart.clampWhenFinished = true;
    await fadeTo(animLiftStart, 0.1);

    // 再生待ち
    let duration = animLiftStart.getClip().duration;
    await new Promise(r => setTimeout(r, duration * 1000));

    // 2. 1秒停止 (そのままのポーズで待機)
    debugLog("Wait 1s...");
    await new Promise(r => setTimeout(r, 1000));

    // 3. 5b (Loop用のモーション) を1回だけ再生
    debugLog("Play 5b Once");
    animLiftLoop.setLoop(THREE.LoopOnce); // ここだけOnceにする
    animLiftLoop.clampWhenFinished = true;
    await fadeTo(animLiftLoop, 0.1);

    // 再生待ち
    duration = animLiftLoop.getClip().duration;
    await new Promise(r => setTimeout(r, duration * 1000));

    // 4. 終了 -> Neutral
    await fadeTo(animNeutral, 0.5);
    
    // 5bの設定をLoopに戻しておく(次回のため)
    animLiftLoop.setLoop(THREE.LoopRepeat);
    
    isProcessing = false;
}

// 移動処理
async function startNavigation(targetPos, boost) {
    if (isLiftingLoop) {
        isLiftingLoop = false;
        // リフティング中なら即キャンセルして走るため設定を戻す
        if(animLiftLoop) animLiftLoop.setLoop(THREE.LoopRepeat);
    }
    
    isProcessing = true; isBoostMode = boost;
    flag.position.copy(targetPos); flag.children[1].material.color.set(isBoostMode ? 0xffd700 : 0xff4757); flag.visible = true;
    
    const toTarget = new THREE.Vector3().subVectors(targetPos, model.position);
    await turnTowards(Math.atan2(toTarget.x, toTarget.z), false);
    
    await fadeTo(animRun, 0.2); 
    isMoving = true;
    
    const speed = isBoostMode ? window.params.dashSpeed : window.params.walkSpeed;
    await new Promise(resolve => {
        const interval = setInterval(() => {
            const dist = model.position.distanceTo(new THREE.Vector3(targetPos.x, model.position.y, targetPos.z));
            if (dist > 0.05) { model.position.add(new THREE.Vector3().subVectors(targetPos, model.position).normalize().setY(0).multiplyScalar(speed)); }
            if (dist <= (isBoostMode ? 0.8 : 0.1)) { clearInterval(interval); resolve(); }
        }, 16);
    });
    
    isMoving = false; flag.visible = false;
    
    const camPos = new THREE.Vector3(); camera.getWorldPosition(camPos);
    await turnTowards(Math.atan2(camPos.x - model.position.x, camPos.z - model.position.z), true);
    
    await fadeTo(animNeutral, 0.5);
    
    isProcessing = false; resetIdleTimer();
}

// --- Animation Helper ---
async function fadeTo(next, dur) {
    if (!next) return;
    if (activeAction === next) return;
    
    if (activeAction) {
        activeAction.fadeOut(dur);
    }
    
    next.reset().setEffectiveWeight(1).fadeIn(dur).play();
    activeAction = next;
    
    await new Promise(r => setTimeout(r, dur * 1000));
}

async function turnTowards(targetAngle, isStepping) {
    if (isStepping) {
        await fadeTo(animRun, 0.2);
        while (true) {
            let diff = targetAngle - model.rotation.y;
            while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
            if (Math.abs(diff) < 0.05) break;
            model.rotation.y += Math.sign(diff) * 0.08; await new Promise(r => requestAnimationFrame(r));
        }
    } else {
        let diff = targetAngle - model.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) > 0.1) {
             const startRot = model.rotation.y;
             for (let i = 0; i <= 20; i++) { 
                 model.rotation.y = startRot + (diff * (i/20)); 
                 await new Promise(r => requestAnimationFrame(r)); 
             }
        } else {
            model.rotation.y = targetAngle;
        }
    }
}

function updateEmotePosition() {
    if (!model) return;
    const pop = document.getElementById('emote-pop');
    if (pop.style.display === 'none') return;
    
    const headPos = model.position.clone().add(new THREE.Vector3(0, 2.6, 0));
    headPos.project(camera);
    
    pop.style.left = `${(headPos.x * .5 + .5) * window.innerWidth}px`;
    pop.style.top = `${(-(headPos.y * .5) + .5) * window.innerHeight}px`;
}

// --- Input Handling ---
window.addEventListener('pointerdown', (e) => {
    if (isOpening || e.target.closest('.ui-panel') || e.target.closest('#debug-panel') || window.isModalOpen) return;
    isDragging = false; pointerDownPos.set(e.clientX, e.clientY);
});
window.addEventListener('pointermove', (e) => { if (new THREE.Vector2(e.clientX, e.clientY).distanceTo(pointerDownPos) > 10) isDragging = true; });
window.addEventListener('pointerup', (e) => {
    if (isOpening || isDragging || e.target.closest('.ui-panel') || e.target.closest('#debug-panel') || window.isModalOpen) return;
    const now = Date.now();
    if (now - lastTapTime < 350) tapStreak++; else tapStreak = 1;
    lastTapTime = now;
    if (tapStreak === 3) { window.openDebug(); tapStreak = 0; return; }
    handleTapAction(e);
});

function handleTapAction(event) {
    if (!model || isProcessing) return;
    resetIdleTimer();
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersectsModel = raycaster.intersectObject(model, true);
    
    if (intersectsModel.length > 0) {
        if (tapResetTimer) { 
            // ダブルタップ
            clearTimeout(tapResetTimer); 
            tapResetTimer = null; 
            
            if (isLiftingLoop) {
                // ループ中なら特殊終了 (5a -> Wait -> 5b -> End)
                stopLiftingSequence();
            } else {
                // 通常ならリフティング開始 (5a -> 5b Loop)
                startLiftingSequence();
            }
        } else { 
            // シングルタップ待機
            tapResetTimer = setTimeout(() => { 
                tapResetTimer = null; 
                // playSingleTapAction(); 
            }, 250); 
        }
        return;
    }
    
    const intersects = raycaster.intersectObject(ground);
    if (intersects.length > 0) {
        const p = intersects[0].point.clone();
        if (tapResetTimer) { clearTimeout(tapResetTimer); tapResetTimer = null; startNavigation(p, true); }
        else { tapResetTimer = setTimeout(() => { tapResetTimer = null; startNavigation(p, false); }, 250); }
    }
}

// --- Main Loop ---
function animate() {
    requestAnimationFrame(animate);
    if (mixer) mixer.update(1/60);
    if (model) {
        blobShadow.position.set(model.position.x, 0.01, model.position.z);
        blobShadow.scale.setScalar(Math.max(0.1, 1.0 - model.position.y * 0.5));
        if (!isOpening && !isDragging) controls.target.lerp(model.position.clone().setY(0.5), 0.1);
    }
    updateEmotePosition(); controls.update(); renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

window.resetCamera = () => { if (isOpening) return; camera.position.copy(DEFAULT_CAM_POS); controls.target.set(0, 0.5, -2); controls.update(); };
window.resetModel = () => { if (!model || isOpening) return; model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); };
