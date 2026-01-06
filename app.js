import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- Global Variables ---
window.params = { walkSpeed: 0.08, dashSpeed: 0.12 };

// --- UI ---
const helpContent = [
    { title: "自由軌道走行", icon: "🎨", desc: "キャラを【長押し】してそのまま地面をなぞる" },
    { title: "連続移動", icon: "🚩", desc: "地面をタップ（最大3か所）" },
    { title: "リフティング", icon: "⚽", desc: "キャラを【ダブルタップ】" }
];

window.isModalOpen = false;
window.openHelpMenu = () => { window.isModalOpen = true; document.getElementById('help-modal').style.display = 'flex'; };
window.closeModal = () => { window.isModalOpen = false; document.getElementById('help-modal').style.display = 'none'; };

// --- Three.js Setup ---
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

// --- Animation Roles ---
let mixer, model, blobShadow;
let animNeutral, animSwing, animRun, animLiftStart, animLiftLoop, animLiftEnd;
let activeAction = null;

// --- Navigation Variables ---
let flags = [];
const MAX_WAYPOINTS = 3;
let waypointQueue = [];
let totalScheduled = 0;
let isFlagInputLocked = false;

// --- Free Draw Variables (挑戦的機能) ---
let isDrawingMode = false;
let drawPoints = [];
let drawLineMesh = null;
const DRAW_THRESHOLD = 500; // 長押し判定 (ms)
let pressTimer = null;

// --- State Flags ---
let isLiftingLoop = false;
let isLiftingActive = false;
let isProcessing = false, isMoving = false, isOpening = true, isDragging = false;
let lastTapTime = 0, tapResetTimer = null;
let pointerDownPos = new THREE.Vector2();
const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.1;
controls.enabled = false;

// --- Helpers: Path Visualizer ---
function createLineMesh() {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({ color: 0x00ffcc, linewidth: 5 });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    scene.add(line);
    return line;
}
drawLineMesh = createLineMesh();

function updateLineMesh(points) {
    const positions = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
        positions[i * 3] = points[i].x;
        positions[i * 3 + 1] = points[i].y + 0.05; // 地面より少し上に
        positions[i * 3 + 2] = points[i].z;
    }
    drawLineMesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    drawLineMesh.geometry.attributes.position.needsUpdate = true;
    drawLineMesh.visible = true;
}

// --- Helpers: Shadow & Flags ---
blobShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.2),
    new THREE.MeshBasicMaterial({ 
        map: new THREE.CanvasTexture(createShadowCanvas()), 
        transparent: true, depthWrite: false, side: THREE.DoubleSide 
    })
);
blobShadow.rotation.x = -Math.PI / 2;
scene.add(blobShadow);

function createShadowCanvas() {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    return canvas;
}

function createFlag() {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1), new THREE.MeshStandardMaterial({ color: 0x888888 }));
    pole.position.y = 0.5;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.02), new THREE.MeshStandardMaterial({ color: 0xff4757 }));
    cloth.position.set(0.2, 0.8, 0);
    g.add(pole, cloth); g.visible = false;
    return g;
}
for(let i=0; i<MAX_WAYPOINTS; i++) {
    const f = createFlag(); scene.add(f); flags.push(f);
}

// --- Asset Loading ---
const modelUrl = './model.glb?v=' + Date.now();
new GLTFLoader().load(modelUrl, (gltf) => {
    model = gltf.scene;
    model.traverse(c => { if(c.isMesh) c.castShadow = true; });
    scene.add(model);
    
    mixer = new THREE.AnimationMixer(model);
    const actionList = [];
    gltf.animations.forEach((clip) => { actionList.push(mixer.clipAction(clip)); });

    animNeutral   = actionList[0];
    animSwing     = actionList[1];
    animRun       = actionList[3];
    animLiftStart = actionList[5];
    animLiftLoop  = actionList[6];
    animLiftEnd   = actionList[7];

    if (animNeutral) animNeutral.setLoop(THREE.LoopRepeat);
    if (animRun)     animRun.setLoop(THREE.LoopRepeat);
    if (animLiftLoop) animLiftLoop.setLoop(THREE.LoopRepeat);

    runOpeningSequence();
});

// --- Core Logic ---

async function runOpeningSequence() {
    model.position.set(0, 0, -12);
    if(animSwing) { animSwing.setLoop(THREE.LoopRepeat); animSwing.play(); activeAction = animSwing; }
    await new Promise(r => setTimeout(r, 2000));
    await fadeTo(animRun, 0.2); 
    isMoving = true;
    while (model.position.z < -2.0) { 
        model.position.z += 0.15; 
        controls.target.set(0, 0.8, model.position.z); 
        controls.update(); 
        await new Promise(r => requestAnimationFrame(r)); 
    }
    isMoving = false;
    await fadeTo(animNeutral, 0.3);
    controls.target.set(0, 0.5, -2); 
    controls.update();
    isOpening = false; controls.enabled = true;
}

// 自由軌道走行の実行
async function followFreePath(points) {
    if (points.length < 2) return;
    isProcessing = true;
    isMoving = true;
    
    // 経路を滑らかにする (CatmullRomCurve3)
    const curve = new THREE.CatmullRomCurve3(points);
    const smoothPoints = curve.getPoints(points.length * 5); // 密度を5倍に
    
    await fadeTo(animRun, 0.2);

    for (let i = 0; i < smoothPoints.length; i++) {
        const target = smoothPoints[i];
        const dist = model.position.distanceTo(new THREE.Vector3(target.x, 0, target.z));
        
        // 向き
        const toTarget = new THREE.Vector3().subVectors(target, model.position);
        model.rotation.y = Math.atan2(toTarget.x, toTarget.z);

        // 移動
        model.position.lerp(new THREE.Vector3(target.x, 0, target.z), 0.2);
        
        // 描画された線を後ろから消していく演出
        const remainingPoints = smoothPoints.slice(i);
        updateLineMesh(remainingPoints);

        await new Promise(r => requestAnimationFrame(r));
    }

    drawLineMesh.visible = false;
    await fadeTo(animNeutral, 0.5);
    
    // 到着後に向き直り
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    await turnTowards(Math.atan2(camPos.x - model.position.x, camPos.z - model.position.z), true);
    await fadeTo(animNeutral, 0.3);

    isMoving = false;
    isProcessing = false;
}

// ウェイポイント移動
async function processNextWaypoint() {
    if (waypointQueue.length === 0) {
        isMoving = false; isProcessing = false;
        await fadeTo(animNeutral, 0.5);
        const camPos = new THREE.Vector3(); camera.getWorldPosition(camPos);
        await turnTowards(Math.atan2(camPos.x - model.position.x, camPos.z - model.position.z), true);
        await fadeTo(animNeutral, 0.5);
        isFlagInputLocked = true;
        setTimeout(() => { isFlagInputLocked = false; totalScheduled = 0; }, 1000);
        return;
    }
    const targetData = waypointQueue[0];
    isMoving = true; isProcessing = true;
    await turnTowards(Math.atan2(targetData.pos.x - model.position.x, targetData.pos.z - model.position.z), false);
    await fadeTo(animRun, 0.2);
    
    await new Promise(resolve => {
        const interval = setInterval(() => {
            const dist = model.position.distanceTo(new THREE.Vector3(targetData.pos.x, 0, targetData.pos.z));
            if (dist > 0.05) {
                const moveVec = new THREE.Vector3().subVectors(targetData.pos, model.position).normalize().multiplyScalar(window.params.walkSpeed);
                model.position.add(moveVec);
            } else { clearInterval(interval); resolve(); }
        }, 16);
    });

    if (flags[targetData.flagIndex]) flags[targetData.flagIndex].visible = false;
    waypointQueue.shift();
    processNextWaypoint();
}

// リフティング終了処理
async function stopLiftingSequence() {
    if (isMoving || !animLiftLoop || !animLiftEnd) return;
    isProcessing = true; isLiftingLoop = false;

    if (activeAction === animLiftLoop) {
        animLiftLoop.setLoop(THREE.LoopOnce);
        await new Promise(resolve => {
            const onFinished = (e) => { if (e.action === animLiftLoop) { mixer.removeEventListener('finished', onFinished); resolve(); } };
            mixer.addEventListener('finished', onFinished);
        });
    }
    await new Promise(r => setTimeout(r, 1000)); // 1秒待機
    await fadeTo(animLiftEnd, 0.1);
    await new Promise(r => setTimeout(r, animLiftEnd.getClip().duration * 1000));
    await fadeTo(animNeutral, 0.5);
    animLiftLoop.setLoop(THREE.LoopRepeat);
    isProcessing = false; isLiftingActive = false;
}

// --- Animation Helper ---
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

// --- Input Handling ---
window.addEventListener('pointerdown', (e) => {
    if (isOpening || window.isModalOpen || e.target.closest('.ui-panel')) return;
    isDragging = false;
    pointerDownPos.set(e.clientX, e.clientY);

    // 長押しタイマー開始
    pressTimer = setTimeout(() => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hit = raycaster.intersectObject(model, true);
        if (hit.length > 0) {
            isDrawingMode = true;
            drawPoints = [model.position.clone()];
            controls.enabled = false; // カメラ回転禁止
        }
    }, DRAW_THRESHOLD);
});

window.addEventListener('pointermove', (e) => {
    if (new THREE.Vector2(e.clientX, e.clientY).distanceTo(pointerDownPos) > 10) {
        isDragging = true;
        if (!isDrawingMode) clearTimeout(pressTimer);
    }

    if (isDrawingMode) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hit = raycaster.intersectObject(ground);
        if (hit.length > 0) {
            const lastPoint = drawPoints[drawPoints.length - 1];
            if (hit[0].point.distanceTo(lastPoint) > 0.2) {
                drawPoints.push(hit[0].point.clone());
                updateLineMesh(drawPoints);
            }
        }
    }
});

window.addEventListener('pointerup', (e) => {
    clearTimeout(pressTimer);
    if (isDrawingMode) {
        isDrawingMode = false;
        followFreePath(drawPoints);
        return;
    }
    if (isOpening || isDragging || window.isModalOpen) return;
    
    const now = Date.now();
    if (now - lastTapTime < 350) {
        // ダブルタップ
        if (tapResetTimer) clearTimeout(tapResetTimer);
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        if (raycaster.intersectObject(model, true).length > 0) {
            if (isLiftingLoop) stopLiftingSequence();
            else startLiftingSequence();
        }
    } else {
        // シングルタップ (予約)
        tapResetTimer = setTimeout(() => {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);
            const hitGround = raycaster.intersectObject(ground);
            if (hitGround.length > 0) handleWaypointAdd(hitGround[0].point.clone());
        }, 250);
    }
    lastTapTime = now;
});

// ウェイポイント追加
function handleWaypointAdd(point) {
    if (isFlagInputLocked || isLiftingActive) return;
    if (totalScheduled >= MAX_WAYPOINTS) return;
    const idx = totalScheduled++;
    waypointQueue.push({ pos: point, flagIndex: idx });
    flags[idx].position.copy(point);
    flags[idx].visible = true;
    const colors = [0xff4757, 0xffd700, 0x2ed573];
    flags[idx].children[1].material.color.set(colors[idx % 3]);
    if (!isMoving && !isProcessing) processNextWaypoint();
}

async function startLiftingSequence() {
    if (isProcessing || isMoving) return;
    isProcessing = true; isLiftingActive = true;
    await fadeTo(animLiftStart, 0.2);
    await new Promise(r => setTimeout(r, animLiftStart.getClip().duration * 1000));
    await fadeTo(animLiftLoop, 0.1);
    isLiftingLoop = true; isProcessing = false;
}

function updateEmotePosition() {
    if (!model) return;
    const pop = document.getElementById('emote-pop');
    if (!pop || pop.style.display === 'none') return;
    const headPos = model.position.clone().add(new THREE.Vector3(0, 2.6, 0));
    headPos.project(camera);
    pop.style.left = `${(headPos.x * .5 + .5) * window.innerWidth}px`;
    pop.style.top = `${(-(headPos.y * .5) + .5) * window.innerHeight}px`;
}

function animate() {
    requestAnimationFrame(animate);
    if (mixer) mixer.update(1/60);
    if (model) {
        blobShadow.position.set(model.position.x, 0.01, model.position.z);
        if (!isOpening && !isDragging) controls.target.lerp(model.position.clone().setY(0.5), 0.1);
    }
    updateEmotePosition();
    controls.update();
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
