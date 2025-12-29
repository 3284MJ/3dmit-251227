import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- Global Variables ---
window.params = { walkSpeed: 0.06, dashSpeed: 0.12 };

// --- UI Logic ---
const helpContent = [
    { title: "歩いて移動", icon: "👆", desc: "地面を【1回タップ】" },
    { title: "ダッシュ移動", icon: "👆👆", desc: "地面を【2回連打】" },
    { title: "ループアクション", icon: "🤫", desc: "ミツハシくんをタップ、または放置" },
    { title: "ワンショット", icon: "🎒", desc: "ミツハシくんを【ダブルタップ】" }
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
function debugLog(msg) { 
    statusEl.innerHTML = msg.replace(/\n/g, '<br>');
    console.log(msg); 
}

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
let animRun = null;   // 走行
let animLoop = null;  // 待機ループ
let animOnce = null;  // ワンショット (Soccer)
let animIdle = null;  // 完全停止 (Neutral)

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
    const actionMap = {};
    const actionList = []; 
    
    let logMsg = `Loaded ${gltf.animations.length} animations:\n`;
    
    gltf.animations.forEach((clip, i) => {
        const action = mixer.clipAction(clip);
        actionMap[clip.name] = action;
        actionList.push(action);
        logMsg += `[${i}] ${clip.name}\n`;
    });
    console.log(logMsg);

    // ★検索ヘルパー
    const find = (keywords) => {
        const hitKey = Object.keys(actionMap).find(name => {
            const lowerName = name.toLowerCase();
            return keywords.some(k => lowerName.includes(k.toLowerCase()));
        });
        return hitKey ? actionMap[hitKey] : null;
    };

    // --- 役職への割り当て ---
    
    // 1. 走行 (アニメ1)
    animRun = find(['run', 'walk', '走行']);
    if (!animRun) animRun = actionList[0];

    // 2. ループアクション (アニメ3)
    animLoop = find(['loop', 'wait', 'idling']);
    if (!animLoop && actionList.length > 2) animLoop = actionList[2];

    // 3. ワンショット (アニメ4)
    animOnce = find(['once', 'shot', 'soccer', 'kick']);
    if (!animOnce && actionList.length > 3) animOnce = actionList[3];

    // 4. 停止/基本 (アニメ5: neutral)
    // ★修正: 最優先で neutral を探す。
    animIdle = find(['neutral', 'stop', 'idle']);
    
    // ★重要修正: neutralが見つからない場合、絶対に animOnce (Soccer) を使わせない。
    // 代わりに animLoop を使う。
    if (!animIdle) {
        console.warn("Neutral/Idle animation not found. Fallback to Loop.");
        animIdle = animLoop || actionList[0]; 
    }

    // --- ループ設定 ---
    if (animRun)  animRun.setLoop(THREE.LoopRepeat);
    if (animLoop) animLoop.setLoop(THREE.LoopRepeat);
    if (animIdle) animIdle.setLoop(THREE.LoopRepeat);
    if (animOnce) {
        animOnce.setLoop(THREE.LoopOnce);
        animOnce.clampWhenFinished = true;
    }

    // デバッグログ確認
    let assignLog = "--- Assignments ---\n";
    assignLog += `Run: ${animRun ? animRun.getClip().name : "None"}\n`;
    assignLog += `Loop: ${animLoop ? animLoop.getClip().name : "None"}\n`;
    assignLog += `Once: ${animOnce ? animOnce.getClip().name : "None"}\n`;
    assignLog += `Idle: ${animIdle ? animIdle.getClip().name : "None"}\n`;
    debugLog(logMsg + assignLog);

    runOpeningSequence();
});

// --- Actions ---

// 1. オープニング
async function runOpeningSequence() {
    // 位置リセット
    model.position.set(0, 0, -12);
    model.rotation.set(0, 0, 0);
    camera.position.set(0, 1.5, 4);
    controls.target.set(0, 0.8, -12); 
    controls.update();
    
    // リロード時はループアクションから開始
    const startAnim = animLoop || animIdle;
    if(startAnim) {
        startAnim.reset().play(); 
        activeAction = startAnim;
    }
    
    await new Promise(r => setTimeout(r, 2000));
    
    // ！表示
    const pop = document.getElementById('emote-pop'); 
    pop.style.display = 'block'; updateEmotePosition();
    await new Promise(r => setTimeout(r, 1000)); pop.style.display = 'none';
    
    // 走行
    await fadeTo(animRun, 0.2); 
    isMoving = true;
    while (model.position.z < -2.0) { 
        model.position.z += 0.15; 
        controls.target.set(0, 0.8, model.position.z); 
        controls.update(); 
        await new Promise(r => requestAnimationFrame(r)); 
    }
    isMoving = false;
    
    // ★終了後: Neutral (Idle) へ遷移
    await fadeTo(animIdle, 0.3);

    controls.target.set(0, 0.5, -2); 
    controls.update();

    isOpening = false; 
    controls.enabled = true; 
    resetIdleTimer(); 
}

// 2. 待機タイマー
function resetIdleTimer() { 
    if (idleTimer) clearTimeout(idleTimer); 
    idleTimer = setTimeout(() => playLoopAction("Idle Timeout"), 30000); 
}

// ループアクション
async function playLoopAction(src) { 
    if (isProcessing || isMoving || !animLoop) return; 
    // debugLog(`Loop: ${src}`); 
    await fadeTo(animLoop, 0.5); 
}

// ワンショット
async function playOnceAction() {
    if (isProcessing || isMoving || !animOnce) return;
    // debugLog("OneShot!");
    isProcessing = true;
    resetIdleTimer();

    animOnce.setLoop(THREE.LoopOnce);
    animOnce.clampWhenFinished = true;

    await fadeTo(animOnce, 0.2);
    
    const duration = animOnce.getClip().duration;
    await new Promise(r => setTimeout(r, duration * 1000));
    
    // ★終了後: Neutral へ
    await fadeTo(animIdle, 0.5);
    
    isProcessing = false;
    resetIdleTimer();
}

// 移動処理
async function startNavigation(targetPos, boost) {
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
    
    // ★終了後: Neutral へ
    await fadeTo(animIdle, 0.5);
    
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
    
    // ★高さ修正: 2.0 -> 2.6
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
            clearTimeout(tapResetTimer); 
            tapResetTimer = null; 
            playOnceAction(); 
        } else { 
            tapResetTimer = setTimeout(() => { 
                tapResetTimer = null; 
                playLoopAction("Single Tap"); 
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
