// --- app.js 全文差し替え ---
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

window.params = { walkSpeed: 0.06, dashSpeed: 0.12 };

// --- リングコマンド設定 ---
const ringMenuEl = document.createElement('div');
ringMenuEl.id = 'ring-menu';
document.body.appendChild(ringMenuEl);

const menuItems = [
    { icon: '⚽', label: 'リフティング', action: () => { if(isLiftingLoop) stopLiftingSequence(); else startLiftingSequence(); } }
];

let isRingMenuOpen = false;
let selectedMenuIndex = -1;

// --- UI Logic ---
window.openHelpMenu = () => { window.isModalOpen = true; document.getElementById('help-modal').style.display = 'flex'; showList(); };
window.closeModal = () => { window.isModalOpen = false; document.getElementById('help-modal').style.display = 'none'; };
window.showList = () => {
    const listEl = document.getElementById('menu-list');
    const detailEl = document.getElementById('detail-area');
    detailEl.style.display = 'none'; listEl.style.display = 'flex'; listEl.style.flexDirection = 'column'; listEl.style.gap = '8px';
    listEl.innerHTML = '';
    const content = [
        { title: "連続移動", icon: "🚩", desc: "地面をタップ（最大3か所予約可能）" },
        { title: "リフティング", icon: "⚽", desc: "ミツハシくんを【ダブルタップ】または【長押しメニュー】" }
    ];
    content.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'help-list-item';
        div.innerHTML = `${item.title} <span>▶</span>`;
        div.onclick = () => {
            listEl.style.display = 'none'; detailEl.style.display = 'block';
            document.getElementById('detail-content').innerHTML = `<span class="detail-icon">${item.icon}</span><div>${item.desc}</div>`;
        };
        listEl.appendChild(div);
    });
};

// --- Three.js Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe0e0e0);
scene.fog = new THREE.Fog(0xe0e0e0, 10, 50);
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
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

const ground = new THREE.Mesh(new THREE.CircleGeometry(15, 64), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

let mixer, model, blobShadow, flags = [];
const MAX_WAYPOINTS = 3;
let waypointQueue = [], totalScheduled = 0, isFlagInputLocked = false;
let activeAction = null, isLiftingLoop = false, isLiftingActive = false;
let isProcessing = false, isMoving = false, isOpening = true, isDragging = false;
let lastTapTime = 0, tapResetTimer = null, pressTimer = null, pointerDownPos = new THREE.Vector2();
const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI / 2 - 0.1; controls.enabled = false;

// Animations
let animNeutral, animSwing, animRun, animLiftStart, animLiftLoop, animLiftEnd;

new GLTFLoader().load('./model.glb?v=' + Date.now(), (gltf) => {
    model = gltf.scene;
    model.traverse(c => { if(c.isMesh) c.castShadow = true; });
    scene.add(model);
    mixer = new THREE.AnimationMixer(model);
    const actionList = [];
    gltf.animations.forEach((clip) => { actionList.push(mixer.clipAction(clip)); });
    animNeutral = actionList[0]; animSwing = actionList[1]; animRun = actionList[3];
    animLiftStart = actionList[5]; animLiftLoop = actionList[6]; animLiftEnd = actionList[7];
    if (animNeutral) animNeutral.setLoop(THREE.LoopRepeat);
    if (animRun) animRun.setLoop(THREE.LoopRepeat);
    if (animLiftLoop) animLiftLoop.setLoop(THREE.LoopRepeat);
    runOpeningSequence();
});

// --- リングコマンド描画ロジック ---
function openRingMenu(x, y) {
    isRingMenuOpen = true;
    controls.enabled = false;
    ringMenuEl.style.display = 'block';
    ringMenuEl.style.left = `${x}px`;
    ringMenuEl.style.top = `${y}px`;
    ringMenuEl.innerHTML = '';

    const radius = 80;
    menuItems.forEach((item, i) => {
        const angle = (i / menuItems.length) * Math.PI * 2 - Math.PI / 2;
        const ix = Math.cos(angle) * radius;
        const iy = Math.sin(angle) * radius;
        const btn = document.createElement('div');
        btn.className = 'ring-item';
        btn.innerHTML = item.icon;
        btn.style.transform = `translate(-50%, -50%) translate(${ix}px, ${iy}px)`;
        ringMenuEl.appendChild(btn);
    });
}

function updateRingMenuSelection(mx, my) {
    if (!isRingMenuOpen) return;
    const rect = ringMenuEl.getBoundingClientRect();
    const cx = rect.left, cy = rect.top;
    const dx = mx - cx, dy = my - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    selectedMenuIndex = -1;
    const items = ringMenuEl.querySelectorAll('.ring-item');
    items.forEach((el, i) => {
        const itemRect = el.getBoundingClientRect();
        const icx = itemRect.left + itemRect.width / 2;
        const icy = itemRect.top + itemRect.height / 2;
        const d = Math.sqrt(Math.pow(mx - icx, 2) + Math.pow(my - icy, 2));
        if (d < 30) {
            el.style.transform += ' scale(1.4)';
            el.classList.add('active');
            selectedMenuIndex = i;
        } else {
            el.classList.remove('active');
        }
    });
}

function closeRingMenu() {
    if (selectedMenuIndex !== -1) menuItems[selectedMenuIndex].action();
    isRingMenuOpen = false;
    ringMenuEl.style.display = 'none';
    if (!isOpening) controls.enabled = true;
}

// --- Input Handling ---
window.addEventListener('pointerdown', (e) => {
    if (isOpening || window.isModalOpen || e.target.closest('.ui-panel')) return;
    isDragging = false;
    pointerDownPos.set(e.clientX, e.clientY);
    
    // 長押し判定開始
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.intersectObject(model, true).length > 0) {
            openRingMenu(e.clientX, e.clientY);
        }
    }, 500);
});

window.addEventListener('pointermove', (e) => {
    if (new THREE.Vector2(e.clientX, e.clientY).distanceTo(pointerDownPos) > 10) {
        isDragging = true;
        if (!isRingMenuOpen) clearTimeout(pressTimer);
    }
    if (isRingMenuOpen) updateRingMenuSelection(e.clientX, e.clientY);
});

window.addEventListener('pointerup', (e) => {
    clearTimeout(pressTimer);
    if (isRingMenuOpen) {
        closeRingMenu();
        return;
    }
    if (isOpening || isDragging || window.isModalOpen) return;
    
    const now = Date.now();
    if (now - lastTapTime < 350) {
        if (tapResetTimer) clearTimeout(tapResetTimer);
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.intersectObject(model, true).length > 0) {
            if (isLiftingLoop) stopLiftingSequence(); else startLiftingSequence();
        }
    } else {
        tapResetTimer = setTimeout(() => {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const hit = raycaster.intersectObject(ground);
            if (hit.length > 0) handleWaypointAdd(hit[0].point.clone());
        }, 250);
    }
    lastTapTime = now;
});

// --- 既存ロジックの継承 ---
async function runOpeningSequence() {
    model.position.set(0, 0, -12);
    if(animSwing) { animSwing.setLoop(THREE.LoopRepeat); animSwing.play(); activeAction = animSwing; }
    await new Promise(r => setTimeout(r, 2000));
    const pop = document.getElementById('emote-pop'); pop.style.display = 'block'; updateEmotePosition();
    await new Promise(r => setTimeout(r, 1000)); pop.style.display = 'none';
    await fadeTo(animRun, 0.2); isMoving = true;
    while (model.position.z < -2.0) { model.position.z += 0.15; controls.target.set(0, 0.8, model.position.z); await new Promise(r => requestAnimationFrame(r)); }
    isMoving = false; await fadeTo(animNeutral, 0.3);
    controls.target.set(0, 0.5, -2); controls.update();
    isOpening = false; controls.enabled = true;
}

async function startLiftingSequence() {
    if (isProcessing || isMoving || !animLiftStart) return;
    isProcessing = true; isLiftingActive = true;
    animLiftStart.setLoop(THREE.LoopOnce); animLiftStart.clampWhenFinished = true;
    await fadeTo(animLiftStart, 0.2);
    await new Promise(r => setTimeout(r, animLiftStart.getClip().duration * 1000));
    await fadeTo(animLiftLoop, 0.1); isLiftingLoop = true; isProcessing = false;
}

async function stopLiftingSequence() {
    if (isMoving || !animLiftLoop || !animLiftEnd) return;
    isProcessing = true; isLiftingLoop = false;
    animLiftLoop.setLoop(THREE.LoopOnce);
    await new Promise(res => {
        const fin = (e) => { if (e.action === animLiftLoop) { mixer.removeEventListener('finished', fin); res(); } };
        mixer.addEventListener('finished', fin);
    });
    await new Promise(r => setTimeout(r, 1000));
    await fadeTo(animLiftEnd, 0.1);
    await new Promise(r => setTimeout(r, animLiftEnd.getClip().duration * 1000));
    await fadeTo(animNeutral, 0.5);
    animLiftLoop.setLoop(THREE.LoopRepeat);
    isProcessing = false; isLiftingActive = false;
}

async function fadeTo(next, dur) {
    if (!next || activeAction === next) return;
    if (activeAction) activeAction.fadeOut(dur);
    next.reset().setEffectiveWeight(1).fadeIn(dur).play();
    activeAction = next;
    await new Promise(r => setTimeout(r, dur * 1000));
}

async function turnTowards(targetAngle, isStepping) {
    let diff = targetAngle - model.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
    if (isStepping) {
        await fadeTo(animRun, 0.2);
        while (Math.abs(diff) > 0.05) {
            diff = targetAngle - model.rotation.y;
            while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
            model.rotation.y += Math.sign(diff) * 0.08; await new Promise(r => requestAnimationFrame(r));
        }
    } else {
        model.rotation.y = targetAngle;
    }
}

function handleWaypointAdd(point) {
    if (isFlagInputLocked || isLiftingActive) return;
    if (totalScheduled >= MAX_WAYPOINTS) return;
    const idx = totalScheduled++;
    waypointQueue.push({ pos: point, flagIndex: idx });
    if (!isMoving && !isProcessing) processNextWaypoint();
}

async function processNextWaypoint() {
    if (waypointQueue.length === 0) {
        isMoving = false; isProcessing = false; await fadeTo(animNeutral, 0.5);
        const camPos = new THREE.Vector3(); camera.getWorldPosition(camPos);
        await turnTowards(Math.atan2(camPos.x - model.position.x, camPos.z - model.position.z), true);
        await fadeTo(animNeutral, 0.5);
        isFlagInputLocked = true; setTimeout(() => { isFlagInputLocked = false; totalScheduled = 0; }, 1000);
        return;
    }
    const target = waypointQueue[0];
    isMoving = true; isProcessing = true;
    await turnTowards(Math.atan2(target.pos.x - model.position.x, target.pos.z - model.position.z), false);
    await fadeTo(animRun, 0.2);
    await new Promise(res => {
        const inv = setInterval(() => {
            const d = model.position.distanceTo(new THREE.Vector3(target.pos.x, 0, target.pos.z));
            if (d > 0.05) model.position.add(new THREE.Vector3().subVectors(target.pos, model.position).normalize().multiplyScalar(window.params.walkSpeed));
            else { clearInterval(inv); res(); }
        }, 16);
    });
    waypointQueue.shift(); processNextWaypoint();
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

function animate() {
    requestAnimationFrame(animate);
    if (mixer) mixer.update(1/60);
    if (model) {
        if (!isOpening && !isDragging) controls.target.lerp(model.position.clone().setY(0.5), 0.1);
    }
    updateEmotePosition();
    controls.update();
    renderer.render(scene, camera);
}
animate();

function addAnimListToDebugMenu(animations) {}
window.resetCamera = () => { camera.position.set(0, 6, 12); controls.target.set(0, 0.5, -2); };
window.resetModel = () => { model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); };
window.updateParam = (k, v) => { window.params[k === 'walk' ? 'walkSpeed' : 'dashSpeed'] = parseFloat(v); };
