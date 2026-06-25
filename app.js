// IOWF MİLYON - Geliştirilmiş 3D WebGL Sürümü (Three.js & Hybrid 2D HUD)

// ================= 1. KATEGORİZE EDİLMİŞ SORU HAVUZU (questions.js dosyasından yüklenir) =================

// Oyun Mantığı Değişkenleri
let activeGameQuestions = [];
let shakeIntensity = 0; // Kilitlenme sarsıntısı için
const TUBE_POSITIONS = {
    A: { x: -4.5, z: 0.5 },
    B: { x: -1.5, z: -0.3 },
    C: { x: 1.5, z: -0.3 },
    D: { x: 4.5, z: 0.5 }
};
let BUNDLE_VALUE = 100000;
let currentQuestionIndex = 0;
let totalMoney = 2000000;
let tableBundles = 20;
let tubeBundles = { A: 0, B: 0, C: 0, D: 0 };
let timerInterval = null;
let timeLeft = 60;
let isMobileMode = false; // Controls WebGL rendering bypass for mobile devices & performance mode

// Dynamic Settings object fetched from API
let configSettings = {
    timerDuration: 60,
    startingMoney: 2000000,
    questionCount: 13,
    announcement: ""
};

async function loadConfigSettings() {
    try {
        const res = await fetch(`/api/settings?t=${Date.now()}`);
        if (res.ok) {
            const data = await res.json();
            configSettings = { ...configSettings, ...data };
            
            // Apply variables
            BUNDLE_VALUE = configSettings.startingMoney / 20;
            totalMoney = configSettings.startingMoney;
            timeLeft = configSettings.timerDuration;
            
            // Update UI elements in intro modal
            const introStartMoneyEl = document.getElementById("intro-start-money");
            if (introStartMoneyEl) {
                introStartMoneyEl.textContent = formatMoney(configSettings.startingMoney);
            }
            
            const ruleQuestionCountEl = document.getElementById("rule-question-count");
            if (ruleQuestionCountEl) {
                ruleQuestionCountEl.innerHTML = `Yarışma toplam <strong>${configSettings.questionCount} sorudan</strong> oluşmaktadır.`;
            }
            
            const ruleTimerEl = document.getElementById("rule-timer");
            if (ruleTimerEl) {
                ruleTimerEl.innerHTML = `Her soru için para dağıtma süreniz tam <strong>${configSettings.timerDuration} saniyedir</strong>.`;
            }
            
            // Announcement banner
            const annBanner = document.getElementById("intro-announcement");
            if (annBanner) {
                if (configSettings.announcement && configSettings.announcement.trim() !== "") {
                    annBanner.textContent = configSettings.announcement;
                    annBanner.classList.remove("hidden");
                } else {
                    annBanner.classList.add("hidden");
                }
            }
            
            // Adjust descriptions inside rules or general texts if needed
            const introModalDesc = document.getElementById("intro-modal-desc");
            if (introModalDesc) {
                introModalDesc.innerHTML = `Başlangıçta kasanızda tam <strong>${formatMoney(configSettings.startingMoney)}</strong> var. Her soruda parayı doğru olduğunu düşündüğünüz şıklara dağıtın.`;
            }
            
            console.log("Game configurations applied:", configSettings);
        }
    } catch (err) {
        console.warn("Failed to fetch settings from API, using client defaults:", err);
    }
}

// Call on startup
loadConfigSettings();
let isLocked = false;
let gameActive = false;
let isMuted = false;
let isTimerPaused = false;
let activeSpeechTimeout = null;
let isDialogEnabled = true; // Türkçe seslendirme açık mı?
let isRevealedState = false; // Cevaplar açıklandı mı?
let savedCorrectLetter = ""; // Açıklanan doğru cevap harfi

// Web Audio API Sentezleyiciler
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let tensionOsc = null;
let tensionGain = null;
const speechSynth = window.speechSynthesis;
let speechRate = 1.0;

// DOM Elemanları
const currentQuestionNumEl = document.getElementById("current-question-num");
const totalMoneyTextEl = document.getElementById("total-money-text");
const questionTextEl = document.getElementById("question-text");
const optATextEl = document.getElementById("opt-a-text");
const optBTextEl = document.getElementById("opt-b-text");
const optCTextEl = document.getElementById("opt-c-text");
const optDTextEl = document.getElementById("opt-d-text");
const bundlesTableEl = document.getElementById("bundles-table");
const tableMoneyTextEl = document.getElementById("table-money-text");
const tableWarningEl = document.getElementById("table-warning");
const timerTextEl = document.getElementById("timer-text");
const timerProgressEl = document.getElementById("timer-progress");
const timerSectionEl = document.querySelector(".timer-section");
const btnLockEl = document.getElementById("btn-lock");
const hostSpeechEl = document.getElementById("host-speech");
const btnMuteEl = document.getElementById("btn-mute");
const muteIconEl = document.getElementById("mute-icon");
const collectAllBtnEl = document.getElementById("collect-all-btn");

// Modallar
const introModalEl = document.getElementById("intro-modal");
const gameoverModalEl = document.getElementById("gameover-modal");
const victoryModalEl = document.getElementById("victory-modal");
const gameoverReachedQuestionEl = document.getElementById("gameover-reached-question");
const winAmountTextEl = document.getElementById("win-amount-text");
const leaderboardModalEl = document.getElementById("leaderboard-modal");
const leaderboardBodyEl = document.getElementById("leaderboard-body");
const usernameInputEl = document.getElementById("username-input");
const usernameLockBadgeEl = document.getElementById("username-lock-badge");
let wasTimerRunningBeforeLeaderboard = false;

// ================= THREE.JS 3D WEBGL KURULUMU =================
let scene, camera, renderer, composer;
let cylinders3D = {}; 
let hatches3D = {}; 
let cashBundles3D = { A: [], B: [], C: [], D: [] };
let tableBundles3D = [];
let spotlight1, spotlight2;
let groundRings = [];
let banknoteTexture = null;
let pipeCurves = {};
let tubeParticles = { A: null, B: null, C: null, D: null };
let confettiParticles = [];
let gltfModels = { fanus: null, safe: null, banknote: null };
let showcaseBase, showcaseGlass, showcaseTop;

// Kamera Hedefleri (Görseldeki gibi geniş ve uzak açı)
let cameraTargetPos = new THREE.Vector3(0, 5.5, 11.5);
let cameraTargetLookAt = new THREE.Vector3(0, 1.5, -2.0);
let cameraCurrentLookAt = new THREE.Vector3(0, 1.5, -2.0);

// Sunucu Durumları
let hostAction = "idle"; 

// 200 TL Banknote Canvas Texture Generator
function createBanknoteTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    
    // Richer lilac-pink of 200 TL bills
    ctx.fillStyle = "#df84ac";
    ctx.fillRect(0, 0, 256, 128);
    
    // Banknote detailed borders
    ctx.strokeStyle = "#a83c72";
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, 244, 116);
    
    ctx.lineWidth = 1;
    ctx.strokeRect(10, 10, 236, 108);
    
    // Wave lines and design ornaments
    ctx.strokeStyle = "rgba(168, 60, 114, 0.5)";
    ctx.beginPath();
    ctx.arc(64, 64, 40, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(128, 10);
    ctx.bezierCurveTo(145, 35, 110, 95, 128, 118);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(10, 64);
    ctx.lineTo(246, 64);
    ctx.stroke();
    
    // Text: "TÜRKİYE CUMHURİYET MERKEZ BANKASI"
    ctx.fillStyle = "#7a2050";
    ctx.font = "bold 9px Outfit, Montserrat, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TÜRKİYE CUMHURİYET MERKEZ BANKASI", 128, 20);
    
    // Watermark circle
    ctx.strokeStyle = "rgba(122, 32, 80, 0.35)";
    ctx.beginPath();
    ctx.arc(185, 64, 26, 0, Math.PI * 2);
    ctx.stroke();
    
    // "200" values in corners
    ctx.fillStyle = "#7a2050";
    ctx.font = "bold 22px Outfit, Montserrat, Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("200", 14, 14);
    ctx.fillText("200", 14, 90);
    
    ctx.textAlign = "right";
    ctx.fillText("200", 242, 14);
    ctx.fillText("200", 242, 90);
    
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

function init3D() {
    const canvas = document.getElementById("studio-canvas");
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050b24); // Deep studio blue instead of pitch black void
    
    banknoteTexture = createBanknoteTexture();
    
    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.copy(cameraTargetPos);
    
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Limit pixel ratio to 1.35 to prevent high-DPI (e.g. 3x Retina/4K) screen lag while keeping it sharp
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // 1. ZEMİN
    const floorGeo = new THREE.CylinderGeometry(8, 8.2, 0.5, 64);
    const floorMat = new THREE.MeshStandardMaterial({ 
        color: 0xe8ecf5, // Light grey/white studio floor tone
        roughness: 0.15, // Glossy reflections
        metalness: 0.05 
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.25;
    floor.receiveShadow = true;
    scene.add(floor);
    
    // Canlı Stüdyo Zemin Neon Halkaları (Gönderilen stüdyo görselindeki gibi dev parlayan halkalar)
    const ring1Geo = new THREE.TorusGeometry(7.8, 0.04, 16, 100);
    ring1Geo.rotateX(Math.PI / 2);
    const ring1Mat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
    const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
    ring1.position.y = 0.02;
    scene.add(ring1);
    
    const ring2Geo = new THREE.TorusGeometry(5.8, 0.03, 16, 100);
    ring2Geo.rotateX(Math.PI / 2);
    const ring2Mat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
    const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
    ring2.position.y = 0.02;
    scene.add(ring2);

    // 1.4. ZEMİN ORTASINDAKİ LOGO (Dinamik Beyaz Arka Plan Temizleme ve Kenar Yumuşatma Entegrasyonu)
    function loadFloorLogo(imageSrc) {
        const img = new Image();
        img.src = imageSrc;
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);
            
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;
            
            // Beyaz arka planı siler ve kenarları yumuşakça şeffaflaştırır (Anti-aliasing)
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i+1];
                const b = data[i+2];
                const a = data[i+3];
                
                // Zaten şeffaf olan pikselleri atla
                if (a === 0) continue;
                
                // Gri/parlaklık değeri hesapla
                const brightness = (r + g + b) / 3;
                if (brightness > 245) {
                    // 245 ile 255 arasında lineer geçişle alpha (şeffaflık) ata
                    const alpha = Math.max(0, (255 - brightness) / 10);
                    data[i+3] = Math.round(alpha * 255);
                }
            }
            ctx.putImageData(imgData, 0, 0);
            
            const logoTexture = new THREE.CanvasTexture(canvas);
            logoTexture.colorSpace = THREE.SRGBColorSpace;
            
            // Logonun en-boy oranını koruyarak geometri oluştur
            const aspect = img.width / img.height;
            const logoWidth = 9.0; // Büyütülmüş zemin logosu (genişlik 9.0 birim)
            const logoHeight = logoWidth / aspect;
            
            const logoGeo = new THREE.PlaneGeometry(logoWidth, logoHeight);
            const logoMat = new THREE.MeshBasicMaterial({
                map: logoTexture,
                transparent: true,
                opacity: 0.9,
                side: THREE.DoubleSide,
                depthWrite: false // z-fighting önlemek için
            });
            
            const logoMesh = new THREE.Mesh(logoGeo, logoMat);
            // Düz zemine serme: X ekseninde 90 derece yatır
            logoMesh.rotation.x = -Math.PI / 2;
            // Kameranın bakış açısına göre düz görünmesi için 0 derece yap (ters çevirme)
            logoMesh.rotation.z = 0;
            
            // Zemin yüksekliği y=0.03 (Z-fighting ve neon halka çakışmasını önler)
            logoMesh.position.set(0, 0.03, 0);
            
            scene.add(logoMesh);
        };
        img.onerror = () => {
            console.warn("Could not load floor logo image: " + imageSrc);
        };
    }
    
    // Yeni yüklenen siyah zemin logosunu yükle
    loadFloorLogo('iowf_logo_floor.png');

    // 1.1. ARKA PLAN LED DUVARI (Curved LED Video Wall)
    const wallGeo = new THREE.CylinderGeometry(9, 9, 5.2, 64, 1, true, -Math.PI / 3, Math.PI / 1.5);
    wallGeo.scale(1, 1, -1);
    
    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = 1024;
    gridCanvas.height = 512;
    const ctx = gridCanvas.getContext("2d");
    
    const wallTexture = new THREE.CanvasTexture(gridCanvas);
    
    function drawLedWall(bgImg) {
        if (bgImg) {
            // Draw custom premium backdrop image
            ctx.drawImage(bgImg, 0, 0, 1024, 512);
        } else {
            // Canlı Mavi-Lacivert Arka Plan (Fallback)
            const grad = ctx.createLinearGradient(0, 0, 0, 512);
            grad.addColorStop(0, "#081136");
            grad.addColorStop(0.5, "#122060");
            grad.addColorStop(1, "#040922");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 1024, 512);
            
            // Yatay Işık Şeritleri
            ctx.strokeStyle = "rgba(0, 242, 254, 0.2)";
            ctx.lineWidth = 3;
            for(let y = 64; y < 512; y += 64) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(1024, y);
                ctx.stroke();
            }
            
            // İnce Dikey Grid Hatları
            ctx.strokeStyle = "rgba(0, 242, 254, 0.1)";
            ctx.lineWidth = 1;
            for(let x = 64; x < 1024; x += 64) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, 512);
                ctx.stroke();
            }
            
            // Parlak Stüdyo Işıkları ve Lens Flare Efektleri
            for(let k = 0; k < 20; k++) {
                const cx = Math.random() * 1024;
                const cy = Math.random() * 320 + 40;
                const r = 40 + Math.random() * 60;
                const radGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
                radGrad.addColorStop(0, "rgba(0, 242, 254, 0.25)");
                radGrad.addColorStop(0.5, "rgba(0, 242, 254, 0.06)");
                radGrad.addColorStop(1, "rgba(0, 242, 254, 0)");
                ctx.fillStyle = radGrad;
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
        // Arka plan ekranına "IOWF MİLYON" yazısı ekleme (Estetik neon ışımalı)
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        // Dış neon parlama (Cyan gölge)
        ctx.shadowColor = "#00f2fe";
        ctx.shadowBlur = 30;
        ctx.fillStyle = "rgba(0, 242, 254, 0.65)";
        ctx.font = "bold 88px Outfit, Montserrat, Arial, sans-serif";
        ctx.fillText("IOWF MİLYON", 512, 256);
        
        // İç parlak gövde (Gold/Sarı renk stüdyo temasıyla uyumlu)
        ctx.shadowBlur = 0; // gölgeyi sıfırla
        ctx.fillStyle = "#ffd700";
        ctx.font = "bold 84px Outfit, Montserrat, Arial, sans-serif";
        ctx.fillText("IOWF MİLYON", 512, 256);
        
        wallTexture.needsUpdate = true;
    }
    
    // Draw default procedural backdrop immediately
    drawLedWall(null);
    
    // Load custom backdrop image asynchronously
    const bgImage = new Image();
    bgImage.src = 'studio_led_backdrop.png';
    bgImage.onload = () => {
        drawLedWall(bgImage);
    };
    bgImage.onerror = () => {
        console.warn("Could not load studio_led_backdrop.png, using procedural fallback.");
    };
    
    const wallMat = new THREE.MeshBasicMaterial({
        map: wallTexture,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
    });
    const ledWall = new THREE.Mesh(wallGeo, wallMat);
    ledWall.position.set(0, 2.6, -4.5);
    scene.add(ledWall);

    // 1.2. YAN NEON SÜTUNLAR
    const columnPositions = [
        { x: -6.8, z: -3.2 },
        { x: -7.6, z: -1.0 },
        { x: 6.8, z: -3.2 },
        { x: 7.6, z: -1.0 }
    ];
    columnPositions.forEach((pos, idx) => {
        const colBaseGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.2, 16);
        const colBaseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8 });
        const colBase = new THREE.Mesh(colBaseGeo, colBaseMat);
        colBase.position.set(pos.x, 0.1, pos.z);
        scene.add(colBase);
        
        const colNeonGeo = new THREE.CylinderGeometry(0.08, 0.08, 5.0, 16);
        const colNeonMat = new THREE.MeshBasicMaterial({ 
            color: idx < 2 ? 0x00f2fe : 0xffd700,
            transparent: true,
            opacity: 0.7
        });
        const colNeon = new THREE.Mesh(colNeonGeo, colNeonMat);
        colNeon.position.set(pos.x, 2.5, pos.z);
        scene.add(colNeon);
    });

    // 1.3. TAVAN IŞIK HALKASI (Truss Ring) - Kaldırıldı (Arka plandaki logoyu kapatmaması için)
    /*
    const trussGeo = new THREE.TorusGeometry(7.2, 0.12, 16, 100);
    trussGeo.rotateX(Math.PI / 2);
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9, roughness: 0.2 });
    const truss = new THREE.Mesh(trussGeo, trussMat);
    truss.position.y = 5.1;
    scene.add(truss);
    */

    // 2. SUNUCU KÜRSÜSÜ (Kaldırıldı - Sunucu artık yerde duracak)

    // Helper to generate 3D circular glowing text labels for pedestals
    function createLetterTexture(letter) {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        
        ctx.clearRect(0, 0, 128, 128);
        
        // Draw glowing circle background
        ctx.fillStyle = "rgba(8, 14, 44, 0.85)";
        ctx.beginPath();
        ctx.arc(64, 64, 56, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = "#00f2fe";
        ctx.lineWidth = 6;
        ctx.stroke();
        
        // Glow effect
        ctx.strokeStyle = "rgba(0, 242, 254, 0.4)";
        ctx.lineWidth = 12;
        ctx.stroke();
        
        // Draw letter text
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 64px Outfit, Montserrat, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(letter, 64, 64);
        
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    }

    // 3. DAĞITILMAYAN PARA KASASI (3D Showcase on the left)
    const showcaseBaseGeo = new THREE.BoxGeometry(1.6, 0.2, 1.6);
    const showcaseBaseMat = new THREE.MeshStandardMaterial({ color: 0x151821, metalness: 0.8, roughness: 0.2 });
    const showcaseTopMat = new THREE.MeshStandardMaterial({ color: 0x273556, metalness: 0.8, roughness: 0.2 });
    
    showcaseBase = new THREE.Mesh(showcaseBaseGeo, showcaseBaseMat);
    showcaseBase.position.set(-6.5, 0.1, 2.6);
    showcaseBase.receiveShadow = true;
    showcaseBase.castShadow = true;
    scene.add(showcaseBase);
    
    // Showcase neon border
    const showcaseNeonGeo = new THREE.BoxGeometry(1.64, 0.04, 1.64);
    const showcaseNeonMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
    const showcaseNeon = new THREE.Mesh(showcaseNeonGeo, showcaseNeonMat);
    showcaseNeon.position.set(-6.5, 0.21, 2.6);
    scene.add(showcaseNeon);
    
    // Glass cover
    const showcaseGlassGeo = new THREE.BoxGeometry(1.5, 1.8, 1.5);
    const showcaseGlassMat = new THREE.MeshPhysicalMaterial({
        color: 0xa5f3fc,
        transparent: true,
        opacity: 0.25,
        roughness: 0.05,
        metalness: 0.1,
        transmission: 0.9,
        ior: 1.5,
        thickness: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    showcaseGlass = new THREE.Mesh(showcaseGlassGeo, showcaseGlassMat);
    showcaseGlass.position.set(-6.5, 1.1, 2.6);
    scene.add(showcaseGlass);
    
    // Top chrome plate
    const showcaseTopGeo = new THREE.BoxGeometry(1.6, 0.1, 1.6);
    showcaseTop = new THREE.Mesh(showcaseTopGeo, showcaseTopMat);
    showcaseTop.position.set(-6.5, 2.05, 2.6);
    scene.add(showcaseTop);

    // Showcase internal light to make banknote stacks shine brightly (subtle fill light)
    const showcaseLight = new THREE.PointLight(0xffffff, 0.25, 4);
    showcaseLight.position.set(-6.5, 1.2, 2.6);
    scene.add(showcaseLight);

    // Showcase Label ("KASA")
    function createShowcaseLabelTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, 256, 128);
        ctx.fillStyle = "rgba(8, 14, 44, 0.85)";
        ctx.beginPath();
        ctx.roundRect(10, 10, 236, 108, 12);
        ctx.fill();
        ctx.strokeStyle = "#00f2fe";
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 32px Outfit, Montserrat, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("KASA", 128, 64);
        return new THREE.CanvasTexture(canvas);
    }
    const showcaseLabelTex = createShowcaseLabelTexture();
    const showcaseLabelGeo = new THREE.PlaneGeometry(0.7, 0.35);
    const showcaseLabelMat = new THREE.MeshBasicMaterial({ 
        map: showcaseLabelTex, 
        transparent: true, 
        side: THREE.DoubleSide 
    });
    const showcaseLabelMesh = new THREE.Mesh(showcaseLabelGeo, showcaseLabelMat);
    showcaseLabelMesh.position.set(-6.5, 0.3, 3.45);
    scene.add(showcaseLabelMesh);

    // 4. DÖRT CAM TÜP (Fanuslar) VE KAİDELERİ
    Object.keys(TUBE_POSITIONS).forEach(letter => {
        const xPos = TUBE_POSITIONS[letter].x;
        const zPos = TUBE_POSITIONS[letter].z;
        
        // Koyu metalik şık stüdyo kaidesi (Pedestal)
        const pedGeo = new THREE.CylinderGeometry(1.1, 1.2, 0.4, 32);
        const pedMat = new THREE.MeshStandardMaterial({ 
            color: 0x151821, 
            roughness: 0.2, 
            metalness: 0.8 
        });
        const pedestal = new THREE.Mesh(pedGeo, pedMat);
        pedestal.position.set(xPos, 0.2, zPos);
        pedestal.receiveShadow = true;
        pedestal.castShadow = true;
        scene.add(pedestal);
        cylinders3D[letter + "_pedestal"] = pedestal;
        
        // Kaide etrafındaki neon halka
        const pedNeonGeo = new THREE.TorusGeometry(1.1, 0.04, 16, 100);
        pedNeonGeo.rotateX(Math.PI / 2);
        const pedNeonMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
        const pedNeon = new THREE.Mesh(pedNeonGeo, pedNeonMat);
        pedNeon.position.set(xPos, 0.4, zPos);
        scene.add(pedNeon);
        cylinders3D[letter + "_neon"] = pedNeon;

        // 3D Dairesel Harf Etiketi (Tüp İçinde - Yükseltilmiş)
        const labelTex = createLetterTexture(letter);
        const labelGeo = new THREE.PlaneGeometry(0.5, 0.5);
        const labelMat = new THREE.MeshBasicMaterial({ 
            map: labelTex, 
            transparent: true, 
            side: THREE.DoubleSide 
        });
        const labelMesh = new THREE.Mesh(labelGeo, labelMat);
        labelMesh.position.set(xPos, 0.85, zPos + 0.65); // elevated inside the glass tube
        scene.add(labelMesh);
        cylinders3D[letter + "_3dLabel"] = labelMesh;

        // Dedicated internal downlight to make the money stacks inside the tube shine bright (subtle fill light)
        const tubeLight = new THREE.PointLight(0xffffff, 0.15, 3.5);
        tubeLight.position.set(xPos, 1.6, zPos);
        scene.add(tubeLight);
        
        // 3D Cam Fanus (Cylinder)
        const glassGeo = new THREE.CylinderGeometry(0.95, 0.95, 2.2, 32, 1, true);
        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0xa5f3fc,
            transparent: true,
            opacity: 0.35,
            roughness: 0.05,
            metalness: 0.15,
            transmission: 0.85,
            ior: 1.52,
            thickness: 0.5,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const glass = new THREE.Mesh(glassGeo, glassMat);
        glass.position.set(xPos, 1.5, zPos);
        scene.add(glass);
        cylinders3D[letter] = glass;
        
        // Cam Fanus Metal İskeleti
        const chromeMat = new THREE.MeshStandardMaterial({ 
            color: 0xdddddd, 
            metalness: 0.95, 
            roughness: 0.05 
        });
        
        // Sol metal sütun direği
        const leftBarGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.2, 8);
        const leftBar = new THREE.Mesh(leftBarGeo, chromeMat);
        leftBar.position.set(xPos - 0.96, 1.5, zPos);
        leftBar.castShadow = true;
        scene.add(leftBar);
        cylinders3D[letter + "_leftBar"] = leftBar;
        
        // Sağ metal sütun direği
        const rightBarGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.2, 8);
        const rightBar = new THREE.Mesh(rightBarGeo, chromeMat);
        rightBar.position.set(xPos + 0.96, 1.5, zPos);
        rightBar.castShadow = true;
        scene.add(rightBar);
        cylinders3D[letter + "_rightBar"] = rightBar;
        
        // Fanus Tepesi Metal Halka
        const topRingGeo = new THREE.TorusGeometry(0.95, 0.04, 16, 100);
        topRingGeo.rotateX(Math.PI / 2);
        const topRing = new THREE.Mesh(topRingGeo, chromeMat);
        topRing.position.set(xPos, 2.6, zPos);
        scene.add(topRing);
        cylinders3D[letter + "_topRing"] = topRing;
        
        // Fanus Taban Metal Halka
        const bottomRingGeo = new THREE.TorusGeometry(0.95, 0.04, 16, 100);
        bottomRingGeo.rotateX(Math.PI / 2);
        const bottomRing = new THREE.Mesh(bottomRingGeo, chromeMat);
        bottomRing.position.set(xPos, 0.42, zPos);
        scene.add(bottomRing);
        cylinders3D[letter + "_bottomRing"] = bottomRing;
        
        // 3D Çift Kanatlı Düşen Kapak (Double Trapdoor - Sarı Renkli ve Merkez Menteşeli)
        const hatchMat = new THREE.MeshStandardMaterial({ 
            color: 0xE4D00A, // Hex #E4D00A sarısı
            roughness: 0.6, 
            metalness: 0.1,
            emissive: 0xE4D00A, // Gölgede kararmayı önlemek için hafif ışıma ekle
            emissiveIntensity: 0.2
        });
        
        // Yarım daire şekli ve ekstrüzyonu (Düz kenar ortada, kavisli kenar dışta/menteşede olacak şekilde)
        const shape = new THREE.Shape();
        shape.absarc(0.85, 0, 0.85, Math.PI / 2, -Math.PI / 2, false);
        shape.lineTo(0.85, 0.85);
        
        const extrudeSettings = { depth: 0.06, bevelEnabled: false };
        const halfHatchGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        halfHatchGeo.rotateX(Math.PI / 2);
        halfHatchGeo.translate(0, 0.03, 0);
        
        // Sol Kapak Menteşesi (Hinge) ve Mesh (Dış kenar menteşeli, aşağı/dışa açılır)
        const leftPivot = new THREE.Group();
        leftPivot.position.set(xPos - 0.85, 0.4, zPos); // Menteşe sol kenarda
        const leftMesh = new THREE.Mesh(halfHatchGeo, hatchMat);
        leftMesh.position.set(0, 0, 0);
        leftMesh.castShadow = true;
        leftPivot.add(leftMesh);
        scene.add(leftPivot);
        
        // Sağ Kapak Menteşesi (Hinge) ve Mesh (Dış kenar menteşeli, aşağı/dışa açılır)
        const rightPivot = new THREE.Group();
        rightPivot.position.set(xPos + 0.85, 0.4, zPos); // Menteşe sağ kenarda
        const rightMesh = new THREE.Mesh(halfHatchGeo, hatchMat);
        rightMesh.rotation.y = Math.PI; // Menteşe sağda olduğu için sola doğru uzansın
        rightMesh.position.set(0, 0, 0);
        rightMesh.castShadow = true;
        rightPivot.add(rightMesh);
        scene.add(rightPivot);
        
        hatches3D[letter] = {
            left: leftPivot,
            right: rightPivot
        };
    });

    // 5. IŞIKLANDIRMA (Daha dengeli ve renkli stüdyo atmosferi)
    const ambientLight = new THREE.AmbientLight(0x28478a, 0.45); // Optimized intensity to prevent overexposure
    scene.add(ambientLight);
    
    // Genel stüdyo aydınlatması için güçlü ana ışık kaynağı
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.35); // Optimized intensity to prevent texture washouts
    mainLight.position.set(0, 10, 8);
    mainLight.target.position.set(0, 0, 0);
    scene.add(mainLight);
    scene.add(mainLight.target);
    
    // Spot Işıkları
    spotlight1 = new THREE.SpotLight(0x00f2fe, 0.7, 25, Math.PI / 4, 0.5, 1); // Balanced spot light
    spotlight1.position.set(-6, 8, 5);
    spotlight1.target.position.set(-2, 1, 0.5);
    spotlight1.castShadow = true;
    // Optimize shadow map size from 1024 to 512 for softer shadows and 4x rendering speedup
    spotlight1.shadow.mapSize.width = 512;
    spotlight1.shadow.mapSize.height = 512;
    scene.add(spotlight1);
    scene.add(spotlight1.target);
    
    spotlight2 = new THREE.SpotLight(0xffd700, 0.5, 25, Math.PI / 4, 0.5, 1); // Balanced spot light
    spotlight2.position.set(6, 8, 5);
    spotlight2.target.position.set(2, 1, 0.5);
    // Disable shadow casting for spotlight2 to reduce shadow rendering passes by 50% (spotlight1 is enough)
    spotlight2.castShadow = false;
    scene.add(spotlight2);
    scene.add(spotlight2.target);
    
    // 6. ŞEFFAF BORULAR (Showcase'den Fanuslara Giden Pnömatik Sistem)
    const pipeMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x00f2fe,
        emissive: 0x00f2fe,
        emissiveIntensity: 0.65, // Bright glowing energy pipe!
        transparent: true,
        opacity: 0.5,
        roughness: 0.1,
        metalness: 0.1,
        transmission: 0.5,
        ior: 1.5,
        thickness: 0.2,
        depthWrite: true,
        side: THREE.DoubleSide
    });

    const startXMap = { A: -7.1, B: -6.7, C: -6.3, D: -5.9 };
    const offsetMap = {
        A: { y: 4.80, z: -2.2 },
        B: { y: 4.86, z: -2.4 },
        C: { y: 4.92, z: -2.6 },
        D: { y: 4.98, z: -2.8 }
    };

    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9, roughness: 0.1 });

    Object.keys(TUBE_POSITIONS).forEach(letter => {
        const xPos = TUBE_POSITIONS[letter].x;
        const zPos = TUBE_POSITIONS[letter].z;
        const tubeTopPos = new THREE.Vector3(xPos, 2.6, zPos);
        
        const startX = startXMap[letter];
        const offset = offsetMap[letter];

        // 4 bağımsız pürüzsüz kavisli boru hattı (T-eklenti çakışması olmadan, arka logoyu kapatmayacak yükseklikte ve derinlikte)
        const p1 = new THREE.Vector3(startX, 2.05, 2.6);
        const p2 = new THREE.Vector3(startX, offset.y, offset.z);
        const p3 = new THREE.Vector3(xPos, offset.y, offset.z);
        const p4 = new THREE.Vector3(xPos, 3.4, zPos + (offset.z - zPos) * 0.4);
        const p5 = tubeTopPos.clone();

        const curve = new THREE.CatmullRomCurve3([p1, p2, p3, p4, p5]);
        pipeCurves[letter] = curve;

        // Her bir şık için kendi bağımsız cam borusunu oluştur (T-kesişimi çakışması olmadan)
        const pipeGeo = new THREE.TubeGeometry(curve, 64, 0.10, 12, false);
        const pipeMesh = new THREE.Mesh(pipeGeo, pipeMaterial);
        scene.add(pipeMesh);

        // Kasa çıkış bağlantı halkası (kesim yerini gizleyen krom flanş)
        const collarGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 16);
        const collar = new THREE.Mesh(collarGeo, chromeMat);
        collar.position.set(startX, 2.05, 2.6);
        scene.add(collar);
    });

    // UnrealBloom Glow Post-Processing Setup
    composer = new THREE.EffectComposer(renderer);
    const renderPass = new THREE.RenderPass(scene, camera);
    composer.addPass(renderPass);

    const bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.4,    // strength (slightly down to prevent washing out)
        0.4,    // radius
        0.65    // threshold (increased so only bright neon light meshes glow, not normal textures like banknotes)
    );
    composer.addPass(bloomPass);

    // Tube bubble particles
    Object.keys(TUBE_POSITIONS).forEach(letter => {
        const particleCount = 20;
        const particleGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const speeds = [];

        for (let i = 0; i < particleCount; i++) {
            const r = Math.random() * 0.7;
            const theta = Math.random() * Math.PI * 2;
            positions[i * 3] = Math.cos(theta) * r;
            positions[i * 3 + 1] = 0.4 + Math.random() * 2.2;
            positions[i * 3 + 2] = Math.sin(theta) * r;
            speeds.push(0.008 + Math.random() * 0.015);
        }

        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const particleMat = new THREE.PointsMaterial({
            color: 0x00f2fe,
            size: 0.08,
            transparent: true,
            opacity: 0.0, // starts invisible
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(particleGeo, particleMat);
        points.position.set(TUBE_POSITIONS[letter].x, 0, TUBE_POSITIONS[letter].z);
        scene.add(points);

        tubeParticles[letter] = {
            points: points,
            speeds: speeds,
            count: particleCount
        };
    });

    // Try loading custom Blender models (defensive fallback approach)
    loadGLTFModels();
    
    window.addEventListener("resize", onWindowResize);
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) {
        composer.setSize(window.innerWidth, window.innerHeight);
    }
}

function loadGLTFModels() {
    if (typeof THREE.GLTFLoader === 'undefined') {
        console.warn("GLTFLoader is not defined. Fallback to procedural meshes.");
        return;
    }
    const loader = new THREE.GLTFLoader();
    
    loader.load('models/fanus.glb', 
        (gltf) => {
            console.log("fanus.glb loaded successfully");
            gltfModels.fanus = gltf.scene;
            applyFanusModels();
        },
        undefined,
        (err) => {
            console.log("models/fanus.glb not found, using procedural meshes");
        }
    );
    
    loader.load('models/safe.glb',
        (gltf) => {
            console.log("safe.glb loaded successfully");
            gltfModels.safe = gltf.scene;
            applySafeModel();
        },
        undefined,
        (err) => {
            console.log("models/safe.glb not found, using procedural meshes");
        }
    );
    
    loader.load('models/banknote.glb',
        (gltf) => {
            console.log("banknote.glb loaded successfully");
            gltfModels.banknote = gltf.scene;
        },
        undefined,
        (err) => {
            console.log("models/banknote.glb not found, using procedural meshes");
        }
    );
}

function applyFanusModels() {
    if (!gltfModels.fanus) return;
    Object.keys(TUBE_POSITIONS).forEach(letter => {
        const keys = ["", "_pedestal", "_leftBar", "_rightBar", "_bottomRing", "_topRing"];
        keys.forEach(suffix => {
            if (cylinders3D[letter + suffix]) cylinders3D[letter + suffix].visible = false;
        });
        
        const model = gltfModels.fanus.clone();
        model.position.set(TUBE_POSITIONS[letter].x, 0.1, TUBE_POSITIONS[letter].z);
        model.scale.set(1.2, 1.2, 1.2);
        scene.add(model);
        cylinders3D[letter + "_gltf"] = model;
    });
}

function applySafeModel() {
    if (!gltfModels.safe) return;
    if (showcaseBase) showcaseBase.visible = false;
    if (showcaseGlass) showcaseGlass.visible = false;
    if (showcaseTop) showcaseTop.visible = false;
    
    const model = gltfModels.safe.clone();
    model.position.set(-6.5, 0.1, 2.6);
    model.scale.set(1.5, 1.5, 1.5);
    scene.add(model);
}

// 3D Tüp Görünürlüğünü Ayarlama (Kategori 3 veya Kategori 2'de şık kilitleme)
function set3DTubeVisibility(letter, visible) {
    if (isMobileMode) return; // Prevent accessing cylinders3D properties in Mobile Mode
    const keys = ["", "_neon", "_pedestal", "_leftBar", "_rightBar", "_bottomRing", "_topRing", "_3dLabel"];
    keys.forEach(suffix => {
        if (cylinders3D[letter + suffix]) {
            cylinders3D[letter + suffix].visible = visible;
        }
    });
    if (hatches3D[letter]) {
        hatches3D[letter].left.visible = visible;
        hatches3D[letter].right.visible = visible;
    }
    // O kanalda kalan paraları da gizle/göster
    cashBundles3D[letter].forEach(bundle => {
        bundle.visible = visible;
    });
}

// 3D Para Destesi Ekle (Boru hattından saçılarak süzülme animasyonlu)
function addCashBundleToTube(letter) {
    if (isMobileMode) return;
    const xPos = TUBE_POSITIONS[letter].x;
    const zPos = TUBE_POSITIONS[letter].z;
    const index = cashBundles3D[letter].length;
    
    let bundle;
    if (gltfModels.banknote) {
        bundle = gltfModels.banknote.clone();
        bundle.scale.set(0.7, 0.7, 0.7);
        // Traverse and gently brighten GLTF materials
        bundle.traverse(child => {
            if (child.isMesh && child.material) {
                if (child.material.emissive !== undefined) {
                    child.material.emissive.setHex(0xe085b0);
                    child.material.emissiveIntensity = 0.38;
                }
            }
        });
    } else {
        const bundleGeo = new THREE.BoxGeometry(0.5, 0.06, 0.25);
        const bundleMat = new THREE.MeshStandardMaterial({ 
            map: banknoteTexture,
            roughness: 0.5,
            metalness: 0.1,
            emissive: 0xe085b0, // Soft pink/lilac glow to naturally brighten the banknote texture
            emissiveIntensity: 0.38
        });
        bundle = new THREE.Mesh(bundleGeo, bundleMat);
        
        const strapGeo = new THREE.BoxGeometry(0.13, 0.07, 0.26);
        const strapMat = new THREE.MeshStandardMaterial({ 
            color: 0xffffff, 
            roughness: 0.2, 
            metalness: 0.1,
            emissive: 0xffffff, // Soft white glow for strap visibility
            emissiveIntensity: 0.28
        });
        const strap = new THREE.Mesh(strapGeo, strapMat);
        bundle.add(strap);
    }
    
    // Piramit/yığın şeklinde koordinatları hesaplama (Ölçeklenmiş balyalar için genişletildi)
    let offsetX = 0;
    let offsetZ = 0;
    let offsetY = 0.45;
    
    if (index < 4) {
        const angle = (index * Math.PI) / 2 + Math.PI / 4;
        offsetX = Math.cos(angle) * 0.28;
        offsetZ = Math.sin(angle) * 0.18;
        offsetY = 0.45;
    } else if (index < 7) {
        const angle = ((index - 4) * Math.PI * 2) / 3;
        offsetX = Math.cos(angle) * 0.18;
        offsetZ = Math.sin(angle) * 0.12;
        offsetY = 0.45 + 0.13;
    } else if (index < 9) {
        offsetX = (index === 7 ? -0.12 : 0.12);
        offsetZ = 0;
        offsetY = 0.45 + 0.26;
    } else {
        offsetX = (Math.random() - 0.5) * 0.08;
        offsetZ = (Math.random() - 0.5) * 0.08;
        offsetY = 0.45 + 0.26 + (index - 8) * 0.13;
    }
    
    // Saçılma efekti için rastgele rotasyonlar ve hafif yatay sapmalar
    const randomRotY = (Math.random() - 0.5) * 1.2;
    const randomRotX = (Math.random() - 0.5) * 0.18;
    const randomRotZ = (Math.random() - 0.5) * 0.18;
    
    // Borunun başlangıç noktasına (Kasa üzeri) yerleştir
    const startPos = pipeCurves[letter].getPointAt(0);
    bundle.position.copy(startPos);
    bundle.rotation.set(randomRotX, randomRotY, randomRotZ);
    bundle.castShadow = true;
    
    bundle.userData = {
        velocity: 0,
        isFalling: false,
        isTravelingPipe: true, // Borudan geçiş aktif
        pipeT: 0,
        pipeSpeed: 0.035, // seyahat hızı
        isSpawning: false, // Borudan çıkınca düşme başlayacak
        spawnVelocity: 0,
        targetY: offsetY,
        floorLevel: offsetY,
        offsetX: offsetX,
        offsetZ: offsetZ,
        randomRotX: randomRotX,
        randomRotY: randomRotY,
        randomRotZ: randomRotZ
    };
    
    scene.add(bundle);
    cashBundles3D[letter].push(bundle);
}

function removeCashBundleFromTube(letter) {
    if (isMobileMode) return;
    const bundles = cashBundles3D[letter];
    if (bundles.length > 0) {
        const lastBundle = bundles.pop();
        scene.remove(lastBundle);
    }
}

// Sunucu görsel ve sprite animasyon fonksiyonları (Kaldırıldı)

function animateHatchOpenAndDrop(letter) {
    if (isMobileMode) return;
    const doubleHatch = hatches3D[letter];
    
    // Sol kapak ve sağ kapak içeriye/aşağıya doğru yavaşça açılır (Aşağıya doğru kelebek açılış)
    doubleHatch.left.userData.targetRotZ = -Math.PI / 1.8; // eksiye dönerek aşağı açılır
    doubleHatch.right.userData.targetRotZ = Math.PI / 1.8;  // artıya dönerek aşağı açılır
    
    // Kapak açılma metal ses efekti
    playHatchOpenSound();
}

function updateShowcaseBundles3D() {
    if (isMobileMode) return;
    // Clear old bundles
    tableBundles3D.forEach(bundle => scene.remove(bundle));
    tableBundles3D = [];
    
    // Add new bundles
    const count = tableBundles;
    for (let i = 0; i < count; i++) {
        let bundle;
        if (gltfModels.banknote) {
            bundle = gltfModels.banknote.clone();
            bundle.scale.set(0.9, 0.9, 0.9);
            // Traverse and gently brighten GLTF materials
            bundle.traverse(child => {
                if (child.isMesh && child.material) {
                    if (child.material.emissive !== undefined) {
                        child.material.emissive.setHex(0xe085b0);
                        child.material.emissiveIntensity = 0.38;
                    }
                }
            });
        } else {
            const bundleGeo = new THREE.BoxGeometry(0.65, 0.08, 0.32);
            const bundleMat = new THREE.MeshStandardMaterial({ 
                map: banknoteTexture,
                roughness: 0.5, 
                metalness: 0.1,
                emissive: 0xe085b0, // Soft pink/lilac glow
                emissiveIntensity: 0.38
            });
            bundle = new THREE.Mesh(bundleGeo, bundleMat);
            
            const strapGeo = new THREE.BoxGeometry(0.16, 0.09, 0.33);
            const strapMat = new THREE.MeshStandardMaterial({ 
                color: 0xffffff, 
                roughness: 0.2, 
                metalness: 0.1,
                emissive: 0xffffff, // Soft white glow
                emissiveIntensity: 0.28
            });
            const strap = new THREE.Mesh(strapGeo, strapMat);
            bundle.add(strap);
        }
        
        // Grid layout inside showcase
        const col = i % 2;
        const row = Math.floor((i % 4) / 2);
        const layer = Math.floor(i / 4);
        
        const xOffset = (col - 0.5) * 0.45;
        const zOffset = (row - 0.5) * 0.45;
        const yOffset = 0.24 + layer * 0.085;
        
        bundle.position.set(-6.5 + xOffset, yOffset, 2.6 + zOffset);
        bundle.rotation.y = (Math.random() - 0.5) * 0.25;
        bundle.castShadow = true;
        
        scene.add(bundle);
        tableBundles3D.push(bundle);
    }
}

function spawnConfetti() {
    confettiParticles.forEach(p => scene.remove(p.mesh));
    confettiParticles = [];
    
    for (let i = 0; i < 150; i++) {
        const geo = new THREE.PlaneGeometry(0.18, 0.09);
        const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(Math.random(), 1.0, 0.5),
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(
            (Math.random() - 0.5) * 12,
            6.0 + Math.random() * 4,
            (Math.random() - 0.5) * 8
        );
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        scene.add(mesh);
        
        confettiParticles.push({
            mesh: mesh,
            velocity: new THREE.Vector3(
                (Math.random() - 0.5) * 0.04,
                -0.03 - Math.random() * 0.04,
                (Math.random() - 0.5) * 0.04
            ),
            rotationSpeed: new THREE.Vector3(
                Math.random() * 0.04,
                Math.random() * 0.04,
                Math.random() * 0.04
            )
        });
    }
}

function reset3DScene() {
    if (isMobileMode) return;
    const letters = ["A", "B", "C", "D"];
    letters.forEach(letter => {
        cashBundles3D[letter].forEach(bundle => {
            scene.remove(bundle);
        });
        cashBundles3D[letter] = [];
        
        if (hatches3D[letter]) {
            hatches3D[letter].left.rotation.z = 0;
            hatches3D[letter].left.userData.targetRotZ = 0;
            hatches3D[letter].left.userData.rotVel = 0;
            hatches3D[letter].right.rotation.z = 0;
            hatches3D[letter].right.userData.targetRotZ = 0;
            hatches3D[letter].right.userData.rotVel = 0;
        }
        
        if (cylinders3D[letter + "_neon"]) {
            cylinders3D[letter + "_neon"].material.color.setHex(0x00f2fe);
        }
        
        // Varsayılan olarak tüm tüpleri tekrar aktif kıl
        set3DTubeVisibility(letter, true);
    });
    
    // Clear and reset 3D showcase bundles
    if (tableBundles3D) {
        tableBundles3D.forEach(bundle => scene.remove(bundle));
        tableBundles3D = [];
    }
    updateShowcaseBundles3D();
    
    cameraTargetPos.set(0, 5.5, 11.5);
    cameraTargetLookAt.set(0, 1.5, -2.0);
    
    hostAction = "idle";
}

// 3D Animasyon Render Döngüsü
function animate(time) {
    requestAnimationFrame(animate);
    
    if (isMobileMode) {
        // If mobile performance mode is active, completely skip Three.js render calculations
        return;
    }
    
    const elapsed = (time || 0) * 0.001;
    
    // Zemin neon halkaları animasyonu kaldırıldı
    
    // 2. KAPAKLARIN AÇILMA ANİMASYONU (HATCH DOORS - Gerilim için Yavaş Açılış)
    Object.keys(hatches3D).forEach(letter => {
        const doubleHatch = hatches3D[letter];
        if (doubleHatch && doubleHatch.left && doubleHatch.right) {
            // Sol Kapak Yavaş Açılış
            const left = doubleHatch.left;
            const targetL = left.userData.targetRotZ || 0;
            if (targetL !== 0) {
                left.rotation.z = THREE.MathUtils.lerp(left.rotation.z, targetL, 0.018);
                
                // Kapak açılmaya başlar başlamaz (en az %5) paraları düşür ve düşme sesini çal
                const bundles = cashBundles3D[letter];
                if (Math.abs(left.rotation.z) >= Math.abs(targetL) * 0.05) {
                    let triggered = false;
                    const xPos = TUBE_POSITIONS[letter].x;
                    const zPos = TUBE_POSITIONS[letter].z;
                    
                    bundles.forEach((bundle) => {
                        if (!bundle.userData.isFalling) {
                            bundle.userData.isTravelingPipe = false;
                            bundle.userData.isSpawning = false;
                            bundle.userData.isFalling = true;
                            
                            // 1. Staggered Delay (Yükseklik tabanlı kademeli düşüş)
                            // Alttaki balyalar hemen düşer, üsttekiler kütle çekimiyle sırayla çöker
                            const heightFactor = bundle.position.y - 0.4;
                            bundle.userData.fallDelay = Math.floor(heightFactor * 25 + Math.random() * 8);
                            
                            // 2. Düz aşağı ve hafif salınım/dönüşle boşluğa düşme hızları
                            bundle.userData.vx = (Math.random() - 0.5) * 0.008; // Delik dışına taşmayacak çok küçük X salınımı
                            bundle.userData.vz = (Math.random() - 0.5) * 0.008; // Delik dışına taşmayacak çok küçük Z salınımı
                            bundle.userData.vy = 0; // Başlangıç dikey hızı
                            
                            // Rastgele 3D yuvarlanma hızları (düşerken gerçekçi takla atma/dönüş)
                            bundle.userData.vrx = (Math.random() - 0.5) * 0.15;
                            bundle.userData.vry = (Math.random() - 0.5) * 0.25;
                            bundle.userData.vrz = (Math.random() - 0.5) * 0.15;
                            
                            triggered = true;
                        }
                    });
                    if (triggered) {
                        playDropSound();
                    }
                }
            } else {
                left.rotation.z = THREE.MathUtils.lerp(left.rotation.z, 0, 0.12);
            }

            // Sağ Kapak Yavaş Açılış
            const right = doubleHatch.right;
            const targetR = right.userData.targetRotZ || 0;
            if (targetR !== 0) {
                right.rotation.z = THREE.MathUtils.lerp(right.rotation.z, targetR, 0.018);
            } else {
                right.rotation.z = THREE.MathUtils.lerp(right.rotation.z, 0, 0.12);
            }
        }
    });
    
    // 3. DÜŞEN VE SAÇILAN PARA DESTEKLERİ FİZİK SİMÜLASYONU
    Object.keys(cashBundles3D).forEach(letter => {
        cashBundles3D[letter].forEach(bundle => {
            if (bundle.userData.isTravelingPipe) {
                // Borudan geçerken normal boyutlarında kalsın
                bundle.scale.set(1, 1, 1);
                
                // Borudan süzülerek geçiş simülasyonu
                bundle.userData.pipeT += bundle.userData.pipeSpeed;
                if (bundle.userData.pipeT >= 1) {
                    bundle.userData.pipeT = 1;
                    bundle.userData.isTravelingPipe = false;
                    bundle.userData.isSpawning = true; // Fanusa düşüşü başlat
                    bundle.userData.spawnVelocity = 0;
                    
                    // Borudan çıkınca fanusun tavanında konumlandır
                    const tubeTopPos = new THREE.Vector3(TUBE_POSITIONS[letter].x, 2.6, TUBE_POSITIONS[letter].z);
                    bundle.position.copy(tubeTopPos);
                } else {
                    const pos = pipeCurves[letter].getPointAt(bundle.userData.pipeT);
                    bundle.position.copy(pos);
                    // Borunun içindeyken tatlı bir dönme hareketi yap
                    bundle.rotation.y += 0.08;
                }
            } else {
                // Borudan çıkınca fanus içinde görünürlüğü artırmak için dinamik olarak 1.8 katına çıkar
                bundle.scale.lerp(new THREE.Vector3(1.8, 1.8, 1.8), 0.1);
                
                if (bundle.userData.isSpawning) {
                    // Fanusa yukarıdan düşerek girme fiziği
                    bundle.userData.spawnVelocity += 0.015; // yerçekimi ivmesi
                    bundle.position.y -= bundle.userData.spawnVelocity;
                    
                    // Hedef katmana çarptığında durdur ve landing sesi çal
                    if (bundle.position.y <= bundle.userData.targetY) {
                        bundle.position.y = bundle.userData.targetY;
                        
                        // Nihai dağınık istif konumuna ve rotasyonuna oturt
                        const xPos = TUBE_POSITIONS[letter].x;
                        const zPos = TUBE_POSITIONS[letter].z;
                        bundle.position.set(xPos + bundle.userData.offsetX, bundle.userData.targetY, zPos + bundle.userData.offsetZ);
                        bundle.rotation.set(bundle.userData.randomRotX, bundle.userData.randomRotY, bundle.userData.randomRotZ);
                        
                        bundle.userData.isSpawning = false;
                    }
                } else if (bundle.userData.isFalling) {
                    if (bundle.userData.fallDelay > 0) {
                        bundle.userData.fallDelay--;
                    } else {
                        // Yerçekimi ivmesi uygula
                        bundle.userData.vy += 0.012;
                        bundle.position.y -= bundle.userData.vy;
                        
                        // Küçük yatay sapma ve 3D takla atma/rotasyon hareketi
                        if (bundle.userData.vx !== undefined) {
                            bundle.position.x += bundle.userData.vx;
                            bundle.position.z += bundle.userData.vz;
                            
                            bundle.rotation.x += bundle.userData.vrx;
                            bundle.rotation.y += bundle.userData.vry;
                            bundle.rotation.z += bundle.userData.vrz;
                        }
                        
                        // Pedestalin altındaki karanlık boşluğa (void) düşüp kaybolma sınırı
                        if (bundle.position.y < -2.0) {
                            bundle.visible = false;
                        }
                    }
                }
            }
        });
    });
    
    // Sunucu platformu animasyonu kaldırıldı
    
    // 5. KAMERA HAREKETİ
    camera.position.lerp(cameraTargetPos, 0.04);
    if (shakeIntensity > 0) {
        camera.position.x += (Math.random() - 0.5) * shakeIntensity;
        camera.position.y += (Math.random() - 0.5) * shakeIntensity;
        camera.position.z += (Math.random() - 0.5) * shakeIntensity;
        shakeIntensity *= 0.88;
        if (shakeIntensity < 0.005) shakeIntensity = 0;
    }
    cameraCurrentLookAt.lerp(cameraTargetLookAt, 0.04);
    camera.lookAt(cameraCurrentLookAt);
    
    // 4. CAM TÜP PARÇACIK ANİMASYONLARI
    Object.keys(tubeParticles).forEach(letter => {
        const data = tubeParticles[letter];
        if (data && data.points) {
            const hasMoney = tubeBundles[letter] > 0;
            if (hasMoney && gameActive) {
                data.points.visible = cylinders3D[letter] ? cylinders3D[letter].visible : true;
                data.points.material.opacity = THREE.MathUtils.lerp(data.points.material.opacity, 0.75, 0.05);
            } else {
                data.points.material.opacity = THREE.MathUtils.lerp(data.points.material.opacity, 0.0, 0.1);
                if (data.points.material.opacity < 0.01) {
                    data.points.visible = false;
                }
            }
            
            if (data.points.visible) {
                const posAttr = data.points.geometry.attributes.position;
                const arr = posAttr.array;
                for (let i = 0; i < data.count; i++) {
                    arr[i * 3 + 1] += data.speeds[i];
                    if (arr[i * 3 + 1] > 2.5) {
                        arr[i * 3 + 1] = 0.4;
                    }
                }
                posAttr.needsUpdate = true;
            }
        }
    });

    // 5. KAZANMA KONFETİ ANİMASYONU
    if (confettiParticles.length > 0) {
        confettiParticles.forEach(p => {
            p.mesh.position.add(p.velocity);
            p.mesh.rotation.x += p.rotationSpeed.x;
            p.mesh.rotation.y += p.rotationSpeed.y;
            p.mesh.rotation.z += p.rotationSpeed.z;
            
            if (p.mesh.position.y < -0.5) {
                p.mesh.position.y = 6.0 + Math.random() * 4.0;
                p.mesh.position.x = (Math.random() - 0.5) * 12;
                p.mesh.position.z = (Math.random() - 0.5) * 8;
                p.velocity.y = -0.03 - Math.random() * 0.04;
            }
        });
    }


    // 7. FLOATING TUBE HUD POSITION UPDATE
    Object.keys(TUBE_POSITIONS).forEach(letter => {
        const tubeContainerEl = document.getElementById(`tube-container-${letter}`);
        if (tubeContainerEl && camera) {
            const xPos = TUBE_POSITIONS[letter].x;
            const zPos = TUBE_POSITIONS[letter].z;
            
            const pos3D = new THREE.Vector3(xPos, 0.25, zPos);
            const tempV = pos3D.clone().project(camera);
            
            const x = (tempV.x * 0.5 + 0.5) * window.innerWidth;
            const y = (tempV.y * -0.5 + 0.5) * window.innerHeight;
            
            const dist = camera.position.distanceTo(pos3D);
            const offsetOffset = 380 / dist; // offset scales with camera distance
            
            tubeContainerEl.style.left = `${x}px`;
            tubeContainerEl.style.top = `${y + offsetOffset}px`;
        }
    });

    if (composer) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}


// ================= OYUN MANTIĞI & ARAYÜZ ENTEGRASYONU =================

// Initialize username from localStorage
function initUsernameField() {
    const storedUsername = localStorage.getItem('iowf_username');
    if (storedUsername && usernameInputEl) {
        usernameInputEl.value = storedUsername;
        usernameInputEl.setAttribute('readonly', 'true');
        usernameInputEl.classList.add('locked-input');
        if (usernameLockBadgeEl) usernameLockBadgeEl.classList.remove('hidden');
        const wrapper = document.querySelector('.username-input-wrapper');
        if (wrapper) wrapper.classList.add('locked');
    }
}

// Scoreboard modal toggle functions
function openLeaderboard() {
    if (leaderboardModalEl) {
        leaderboardModalEl.classList.remove('hidden');
        loadLeaderboard();
        
        // Pause timer if game is active
        if (gameActive && !isLocked && !isTimerPaused) {
            isTimerPaused = true;
            wasTimerRunningBeforeLeaderboard = true;
            if (btnPauseTimerEl) {
                btnPauseTimerEl.classList.add("paused");
                btnPauseTimerEl.textContent = "SÜREYİ BAŞLAT";
            }
            stopTensionDrone();
        }
    }
}

function closeLeaderboard() {
    if (leaderboardModalEl) {
        leaderboardModalEl.classList.add('hidden');
        
        // Resume timer if it was running before
        if (wasTimerRunningBeforeLeaderboard) {
            isTimerPaused = false;
            wasTimerRunningBeforeLeaderboard = false;
            if (btnPauseTimerEl) {
                btnPauseTimerEl.classList.remove("paused");
                btnPauseTimerEl.textContent = "SÜREYİ DURDUR";
            }
            if (!isMuted && gameActive && !isLocked) {
                startTensionDrone();
            }
        }
    }
}

function loadLeaderboard() {
    if (!leaderboardBodyEl) return;
    leaderboardBodyEl.innerHTML = '<tr><td colspan="4" class="loading-scores">Skorlar yükleniyor...</td></tr>';
    
    fetch('/api/scores')
        .then(res => res.json())
        .then(scores => {
            leaderboardBodyEl.innerHTML = '';
            if (scores.length === 0) {
                leaderboardBodyEl.innerHTML = '<tr><td colspan="4" class="no-scores">Henüz kaydedilmiş skor yok. İlk siz olun!</td></tr>';
                return;
            }
            
            scores.forEach((s, index) => {
                const tr = document.createElement('tr');
                const rank = index + 1;
                if (rank === 1) tr.className = 'rank-1';
                else if (rank === 2) tr.className = 'rank-2';
                else if (rank === 3) tr.className = 'rank-3';
                
                const formattedMoney = s.money.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " TL";
                
                tr.innerHTML = `
                    <td><span class="rank-badge">${rank}</span></td>
                    <td>
                        <div class="player-name-cell">
                            ${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : ''} ${escapeHtml(s.username)}
                        </div>
                    </td>
                    <td class="money-cell">${formattedMoney}</td>
                    <td class="question-cell">${s.questionReached} / ${configSettings.questionCount}</td>
                `;
                leaderboardBodyEl.appendChild(tr);
            });
        })
        .catch(err => {
            console.error("Leaderboard fetch failed:", err);
            leaderboardBodyEl.innerHTML = '<tr><td colspan="4" class="no-scores">Skorlar yüklenirken bir hata oluştu!</td></tr>';
        });
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function submitScore(money, questionReached) {
    const username = localStorage.getItem('iowf_username') || 'Bilinmeyen Yarışmacı';
    fetch('/api/scores', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            username: username,
            money: money,
            questionReached: questionReached
        })
    })
    .then(res => res.json())
    .then(data => {
        console.log("Score submitted successfully:", data);
    })
    .catch(err => {
        console.error("Score submission failed:", err);
    });
}

// Oyunu Başlat Dinleyicileri
document.getElementById("btn-start-game").addEventListener("click", () => {
    const username = usernameInputEl ? usernameInputEl.value.trim() : '';
    if (!username) {
        const wrapper = document.querySelector('.username-input-wrapper');
        if (wrapper) {
            wrapper.style.borderColor = 'var(--neon-red)';
            wrapper.style.boxShadow = 'var(--neon-red-glow)';
            wrapper.classList.add('shake-anim');
            setTimeout(() => {
                wrapper.classList.remove('shake-anim');
                if (!wrapper.classList.contains('locked')) {
                    wrapper.style.borderColor = 'var(--border-glass)';
                    wrapper.style.boxShadow = 'none';
                } else {
                    wrapper.style.borderColor = 'var(--neon-gold)';
                    wrapper.style.boxShadow = 'none';
                }
            }, 800);
        }
        return;
    }
    
    // Lock username
    localStorage.setItem('iowf_username', username);
    if (usernameInputEl) {
        usernameInputEl.setAttribute('readonly', 'true');
        usernameInputEl.classList.add('locked-input');
    }
    if (usernameLockBadgeEl) usernameLockBadgeEl.classList.remove('hidden');
    const wrapper = document.querySelector('.username-input-wrapper');
    if (wrapper) wrapper.classList.add('locked');

    introModalEl.classList.add("hidden");
    const studioContainer = document.querySelector(".studio-container");
    if (studioContainer) {
        studioContainer.classList.remove("studio-hidden");
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    if (!renderer && !isMobileMode) {
        init3D();
    }
    startGame();
});

document.getElementById("btn-restart-lost").addEventListener("click", () => {
    gameoverModalEl.classList.add("hidden");
    startGame();
});

document.getElementById("btn-restart-won").addEventListener("click", () => {
    victoryModalEl.classList.add("hidden");
    startGame();
});

// Bind Leaderboard click events
const btnOpenLeaderboardIntro = document.getElementById("btn-open-leaderboard-intro");
if (btnOpenLeaderboardIntro) {
    btnOpenLeaderboardIntro.addEventListener("click", openLeaderboard);
}

const btnOpenLeaderboardGame = document.getElementById("btn-open-leaderboard-game");
if (btnOpenLeaderboardGame) {
    btnOpenLeaderboardGame.addEventListener("click", openLeaderboard);
}

const btnCloseLeaderboard = document.getElementById("btn-close-leaderboard");
if (btnCloseLeaderboard) {
    btnCloseLeaderboard.addEventListener("click", closeLeaderboard);
}

// Mobile / 3D Mode Toggle Event Bindings
const btnMobileToggle = document.getElementById("btn-mobile-toggle");
if (btnMobileToggle) {
    // Detect mobile user-agents or small screen sizes to pre-enable Mobile Mode automatically
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
    
    // Toggle Mobile Mode function
    const setMobileMode = (enable) => {
        isMobileMode = enable;
        
        if (isMobileMode) {
            btnMobileToggle.style.display = "none"; // Hide button entirely if mobile is forced
            document.body.classList.add("mobile-performance-layout");
            
            // Turn off 3D WebGL rendering visibility to save GPU
            const canvas = document.getElementById("studio-canvas");
            if (canvas) canvas.style.display = "none";
        } else {
            btnMobileToggle.style.display = "inline-block";
            btnMobileToggle.textContent = "💻 3D MODU: AÇIK";
            document.body.classList.remove("mobile-performance-layout");
            
            // Re-show 3D Canvas
            const canvas = document.getElementById("studio-canvas");
            if (canvas) canvas.style.display = "block";
            
            // Re-run Three.js loop resize
            if (renderer) {
                onWindowResize();
            }
        }
    };

    // Auto force mobile mode on small screens or mobile user agents
    if (isMobileDevice) {
        setMobileMode(true);
    } else {
        const savedSetting = localStorage.getItem("iowf_mobile_mode");
        setMobileMode(savedSetting === "true");
    }

    // Dynamic resize handler to automatically toggle mobile view based on window size
    const handleResizeMobileMode = () => {
        const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (isMobileUA) {
            setMobileMode(true);
            return;
        }
        if (window.innerWidth <= 768) {
            if (!isMobileMode) setMobileMode(true);
        } else {
            const savedSetting = localStorage.getItem("iowf_mobile_mode");
            if (savedSetting !== "true" && isMobileMode) {
                setMobileMode(false);
            }
        }
    };
    window.addEventListener("resize", handleResizeMobileMode);

    btnMobileToggle.addEventListener("click", () => {
        if (isMobileDevice) return; // Prevent toggling on real mobile screens
        setMobileMode(!isMobileMode);
        localStorage.setItem("iowf_mobile_mode", isMobileMode ? "true" : "false");
    });
}

// Mobile Updates Modal Bindings
const updatesModalEl = document.getElementById("updates-modal");
const btnOpenUpdatesMobile = document.getElementById("btn-open-updates-mobile");
const btnCloseUpdates = document.getElementById("btn-close-updates");

if (btnOpenUpdatesMobile && updatesModalEl) {
    btnOpenUpdatesMobile.addEventListener("click", () => {
        updatesModalEl.classList.remove("hidden");
    });
}
if (btnCloseUpdates && updatesModalEl) {
    btnCloseUpdates.addEventListener("click", () => {
        updatesModalEl.classList.add("hidden");
    });
}

// Call immediate field init
initUsernameField();

// Mute Kontrolü (Efekt Sesleri)
btnMuteEl.addEventListener("click", () => {
    isMuted = !isMuted;
    if (isMuted) {
        btnMuteEl.classList.add("muted");
        stopTensionDrone();
    } else {
        btnMuteEl.classList.remove("muted");
        if (gameActive && !isLocked && !isTimerPaused) {
            startTensionDrone();
        }
    }
});

// Dialog Kontrolü (Türkçe Seslendirme Aç/Kapat)
const btnDialogEl = document.getElementById("btn-dialog");
if (btnDialogEl) {
    btnDialogEl.addEventListener("click", () => {
        isDialogEnabled = !isDialogEnabled;
        if (isDialogEnabled) {
            btnDialogEl.classList.remove("disabled");
        } else {
            btnDialogEl.classList.add("disabled");
            
            // Eğer aktif bir ses çalma varsa veya sentezleyici çalışıyorsa callback'i tetikle
            let hasCallback = false;
            if (currentAudio) {
                if (currentAudio.onended) {
                    currentAudio.onended();
                    hasCallback = true;
                }
                currentAudio.pause();
                currentAudio = null;
            }
            speechSynth.cancel();
            
            const wf = document.getElementById("host-waveform");
            if (wf) wf.classList.remove("active");
        }
    });
}

// Duraklatma Butonu Click Dinleyicisi
const btnPauseTimerEl = document.getElementById("btn-pause-timer");
if (btnPauseTimerEl) {
    btnPauseTimerEl.addEventListener("click", () => {
        if (!gameActive || isLocked) return;
        
        isTimerPaused = !isTimerPaused;
        if (isTimerPaused) {
            btnPauseTimerEl.classList.add("paused");
            btnPauseTimerEl.textContent = "SÜREYİ BAŞLAT";
            stopTensionDrone();
        } else {
            btnPauseTimerEl.classList.remove("paused");
            btnPauseTimerEl.textContent = "SÜREYİ DURDUR";
            if (!isMuted) startTensionDrone();
        }
    });
}

// Global Audio element for TTS playback
let currentAudio = null;

// Sayıları Türkçe kelimelere çevirme yardımcı fonksiyonları (TTS motorunun düzgün telaffuz etmesi için)
function numberToTurkishWords(num) {
    if (num === 0) return "sıfır";
    
    const ones = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
    const tens = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
    const units = ["", "bin", "milyon", "milyar", "trilyon"];
    
    let words = [];
    let unitIndex = 0;
    
    let temp = num;
    while (temp > 0) {
        let chunk = temp % 1000;
        if (chunk > 0) {
            let chunkWords = [];
            let h = Math.floor(chunk / 100);
            let t = Math.floor((chunk % 100) / 10);
            let o = chunk % 10;
            
            if (h > 0) {
                if (h > 1) {
                    chunkWords.push(ones[h]);
                }
                chunkWords.push("yüz");
            }
            
            if (t > 0) {
                chunkWords.push(tens[t]);
            }
            
            if (o > 0) {
                chunkWords.push(ones[o]);
            }
            
            if (unitIndex === 1 && chunk === 1) {
                words.unshift("bin");
            } else {
                let chunkStr = chunkWords.join(" ");
                if (units[unitIndex]) {
                    chunkStr += " " + units[unitIndex];
                }
                words.unshift(chunkStr);
            }
        }
        temp = Math.floor(temp / 1000);
        unitIndex++;
    }
    
    return words.join(" ").trim();
}

function ordinalToTurkishWords(num) {
    const baseWords = numberToTurkishWords(num);
    const words = baseWords.split(" ");
    const lastWord = words[words.length - 1];
    
    const suffixes = {
        "sıfır": "sıfırıncı",
        "bir": "birinci",
        "iki": "ikinci",
        "üç": "üçüncü",
        "dört": "dördüncü",
        "beş": "beşinci",
        "altı": "altıncı",
        "yedi": "yedinci",
        "sekiz": "sekizinci",
        "dokuz": "dokuzuncu",
        "on": "onuncu",
        "yirmi": "yirminci",
        "otuz": "otuzuncu",
        "kırk": "kırkıncı",
        "elli": "ellinci",
        "altmış": "altmışıncı",
        "yetmiş": "yetmişinci",
        "seksen": "sekseninci",
        "doksan": "doksanıncı",
        "yüz": "yüzüncü",
        "bin": "bininci",
        "milyon": "milyonuncu",
        "milyar": "milyarıncı",
        "trilyon": "trilyonuncu"
    };
    
    if (suffixes[lastWord]) {
        words[words.length - 1] = suffixes[lastWord];
        return words.join(" ");
    }
    
    return baseWords + "inci";
}

function convertNumbersToTurkishWords(text) {
    if (!text) return "";
    
    let processedText = text;
    
    // 1. Sıra sayıları: örn. "19. yüzyıl" veya "1. Dünya Savaşı"
    processedText = processedText.replace(/\b\d+\.(?=\s+(?:[a-zğüşıöç]|Dünya|Selim|Süleyman|Murat|Mehmet|Osman|Mahmut|Beyazıt|Görsel|Kanal|Madde|Soru))/g, (match) => {
        const val = parseInt(match, 10);
        return ordinalToTurkishWords(val);
    });
    
    // 2. Noktalı büyük sayılar: örn. 2.000.000 veya 500.000
    processedText = processedText.replace(/\b\d+(?:\.\d+)+\b/g, (match) => {
        return match.replace(/\./g, "");
    });
    
    // 3. Virgüllü ondalık sayılar: örn. 1,5 veya 2,5
    processedText = processedText.replace(/\b\d+,\d+\b/g, (match) => {
        const parts = match.split(",");
        const integerPart = numberToTurkishWords(parseInt(parts[0], 10));
        const decimalPart = numberToTurkishWords(parseInt(parts[1], 10));
        return `${integerPart} virgül ${decimalPart}`;
    });
    
    // 4. Standart sayılar: örn. 1994, 60, 13
    processedText = processedText.replace(/\b\d+\b/g, (match) => {
        const val = parseInt(match, 10);
        if (isNaN(val)) return match;
        return numberToTurkishWords(val);
    });
    
    return processedText;
}

// Seslendirme (Yapay Zeka Ses Sentezleme - API ve Yerel Fallback)
function hostSpeak(text, callback) {
    if (!isDialogEnabled) {
        if (callback) {
            // Simulate speaking duration when dialog sound is off, so lids don't open instantly
            const delay = Math.max(1500, text.length * 65);
            setTimeout(callback, delay);
        }
        return;
    }
    
    // Stop any current voice playbacks
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    if ('speechSynthesis' in window) {
        speechSynth.cancel();
    }
    
    // Clean text for speech and convert numbers to Turkish words
    let cleanText = text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\n/g, ' ');
    cleanText = convertNumbersToTurkishWords(cleanText);
    
    // Ses dalgası ikonunu göster
    const wf = document.getElementById("host-waveform");
    if (wf) wf.classList.add("active");
    
    const hideWf = () => {
        if (wf) wf.classList.remove("active");
    };
    
    // Call server speak API
    fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText })
    })
    .then(async res => {
        // Prevent race condition if user turned off dialog sound while loading
        if (!isDialogEnabled) {
            hideWf();
            if (callback) callback();
            return;
        }
        
        if (!res.ok) {
            console.warn("TTS API returned non-OK status:", res.status);
            hostSpeakLocal(cleanText, () => {
                hideWf();
                if (callback) callback();
            });
            return;
        }
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await res.json();
            if (data.fallback) {
                hostSpeakLocal(cleanText, () => {
                    hideWf();
                    if (callback) callback();
                });
            } else {
                hideWf();
                if (callback) callback();
            }
        } else {
            // Audio binary stream returned
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            currentAudio = new Audio(url);
            currentAudio.onended = () => {
                URL.revokeObjectURL(url);
                currentAudio = null;
                hideWf();
                if (callback) callback();
            };
            currentAudio.onerror = (e) => {
                console.warn("TTS Audio element playback error, falling back to local speech synthesis", e);
                URL.revokeObjectURL(url);
                currentAudio = null;
                hostSpeakLocal(cleanText, () => {
                    hideWf();
                    if (callback) callback();
                });
            };
            currentAudio.play().catch(playErr => {
                console.warn("TTS Audio play blocked, falling back to local speech synthesis", playErr);
                hostSpeakLocal(cleanText, () => {
                    hideWf();
                    if (callback) callback();
                });
            });
        }
    })
    .catch(err => {
        console.warn("TTS API call failed, falling back to local speech synthesis:", err);
        hostSpeakLocal(cleanText, () => {
            hideWf();
            if (callback) callback();
        });
    });
}

function hostSpeakLocal(cleanText, callback) {
    if (!isDialogEnabled || !('speechSynthesis' in window)) {
        if (callback) callback();
        return;
    }
    
    // Ses dalgası ikonunu göster
    const wf = document.getElementById("host-waveform");
    if (wf) wf.classList.add("active");
    
    speechSynth.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Sistemdeki Türkçe seslendirmeleri filtrele
    const voices = speechSynth.getVoices();
    const trVoices = voices.filter(voice => voice.lang.startsWith('tr') || voice.lang.includes('TR'));
    
    // Öncelikli olarak bilinen kadın Türkçe seslerini ara
    let trVoice = trVoices.find(voice => {
        const name = voice.name.toLowerCase();
        return name.includes('emel') || 
               name.includes('yelda') || 
                  name.includes('seda') || 
                  name.includes('zeynep') || 
                  name.includes('sila') || 
                  name.includes('hazel') || 
                  name.includes('hulya') || 
                  name.includes('dilara') || 
                  name.includes('sibel') || 
                  name.includes('filiz') || 
                  name.includes('google') || // Chrome's default Google Türkçe is female
                  name.includes('female') || 
                  name.includes('woman') || 
                  name.includes('girl');
    });
    
    let isArtificialFemale = false;
    if (!trVoice && trVoices.length > 0) {
        // Eğer kadın ses bulunamadıysa, erkek sesleri (tolga, cem, male) hariç diğer Türkçe sesleri aramaya çalışalım
        trVoice = trVoices.find(voice => {
            const name = voice.name.toLowerCase();
            return !name.includes('tolga') && !name.includes('cem') && !name.includes('male');
        });
        
        // Eğer yine de bulamazsak (örneğin sadece Tolga/Cem varsa), ilk mevcut Türkçe sesi seç ve yapay inceltme uygula
        if (!trVoice) {
            trVoice = trVoices[0];
            isArtificialFemale = true;
        }
    }
    
    if (trVoice) {
        utterance.voice = trVoice;
    } else {
        utterance.lang = 'tr-TR';
    }
    
    utterance.rate = 1.0; // Doğal okuma hızı
    utterance.pitch = isArtificialFemale ? 1.4 : 1.0; // Kadınsı yapay ses için perdeyi yükselt
    
    utterance.onend = () => {
        if (wf) wf.classList.remove("active");
        if (callback) callback();
    };
    utterance.onerror = () => {
        if (wf) wf.classList.remove("active");
        if (callback) callback();
    };
    
    speechSynth.speak(utterance);
}

// Ses listesinin tarayıcıda yüklenmesini tetikleme
if ('speechSynthesis' in window) {
    speechSynth.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
        speechSynth.getVoices();
    };
}

// Fisher-Yates Karıştırma Algoritması (Kusursuz Rastgelelik)
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// 13 Soruluk Akış Kurulumu (Tüm Sorular 4 Şıklı)
function prepareGameQuestions() {
    const selected = shuffleArray(CAT_4_QUESTIONS).slice(0, 13);
    activeGameQuestions = selected.map(q => ({
        ...q,
        optionsCount: 4 // force 4 options
    }));
}

async function fetchGameQuestions() {
    try {
        const response = await fetch('/api/questions');
        if (!response.ok) throw new Error("API error: " + response.statusText);
        activeGameQuestions = await response.json();
        console.log("Loaded questions from API:", activeGameQuestions);
    } catch (err) {
        console.warn("API questions fetch failed, falling back to local questions.txt", err);
        prepareGameQuestions();
    }
}

async function startGame() {
    if ('speechSynthesis' in window) {
        speechSynth.cancel();
    }
    if (activeSpeechTimeout) {
        clearTimeout(activeSpeechTimeout);
        activeSpeechTimeout = null;
    }
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    clearInterval(timerInterval);
    
    currentQuestionIndex = 0;
    totalMoney = configSettings.startingMoney;
    gameActive = true;
    
    // Clean up confetti
    confettiParticles.forEach(p => scene.remove(p.mesh));
    confettiParticles = [];
    
    await fetchGameQuestions();
    
    if (renderer) {
        reset3DScene();
    }
    loadQuestion(currentQuestionIndex);
}

// Soru Yükleme
function loadQuestion(index) {
    isLocked = false;
    isRevealedState = false; // Cevap açıklama durumunu sıfırla
    timeLeft = configSettings.timerDuration;
    isTimerPaused = false; // Reset pause state for new question
    
    btnLockEl.textContent = "CEVABI KİLİTLE";
    
    tableBundles = totalMoney / BUNDLE_VALUE;
    tubeBundles = { A: 0, B: 0, C: 0, D: 0 };
    
    // UI Element Sıfırlama
    document.querySelectorAll(".tube-container").forEach(el => {
        el.className = "tube-container"; 
    });
    document.querySelectorAll(".option-card").forEach(el => {
        el.className = "option-card"; 
    });
    
    // Duraklatma butonu görünümünü sıfırla
    const btnPause = document.getElementById("btn-pause-timer");
    if (btnPause) {
        btnPause.disabled = false;
        btnPause.textContent = "SÜREYİ DURDUR";
        btnPause.classList.remove("paused");
    }
    
    reset3DScene();
    
    const qData = activeGameQuestions[index];
    const optCount = qData.optionsCount || 4;
    
    currentQuestionNumEl.textContent = `${index + 1} / ${configSettings.questionCount}`;
    totalMoneyTextEl.textContent = formatMoney(totalMoney);
    questionTextEl.textContent = qData.question;
    
    // Soru seçenek kartları ve 3D tüplerin görünürlüğünü ayarla (Kademeli Zorlaşma)
    const letters = ["A", "B", "C", "D"];
    letters.forEach((letter, i) => {
        const optionCard = document.querySelector(`.option-card[data-option="${letter}"]`);
        const tubeContainer = document.getElementById(`tube-container-${letter}`);
        
        if (i < optCount) {
            // Şıkkı ve tüp butonlarını göster
            optionCard.style.visibility = "visible";
            tubeContainer.style.visibility = "visible";
            // 3D sahnede tüpü göster
            set3DTubeVisibility(letter, true);
            
            // Şık metnini yaz
            document.getElementById(`opt-${letter.toLowerCase()}-text`).textContent = qData.options[letter];
        } else {
            // Şıkkı ve tüp butonlarını gizle
            optionCard.style.visibility = "hidden";
            tubeContainer.style.visibility = "hidden";
            // 3D sahnede tüpü gizle
            set3DTubeVisibility(letter, false);
        }
    });
    
    const ordinalWords = [
        "Birinci", "İkinci", "Üçüncü", "Dördüncü", "Beşinci",
        "Altıncı", "Yedinci", "Sekizinci", "Dokuzuncu", "Onuncu",
        "On birinci", "On ikinci", "On üçüncü"
    ];
    const introSpeech = `${ordinalWords[index]} soru geliyor. ${qData.question}`;
    if (hostSpeechEl) {
        hostSpeechEl.textContent = `${index + 1}. soru: Paraları dağıtmaya başlayabilirsiniz!`;
    }
    hostSpeak(introSpeech);
    
    updateMoneyUI();
    
    startTimer();
    if (!isMuted) startTensionDrone();
}

function updateMoneyUI() {
    tableMoneyTextEl.textContent = formatMoney(tableBundles * BUNDLE_VALUE);
    
    if (bundlesTableEl) {
        bundlesTableEl.innerHTML = "";
        for (let i = 0; i < tableBundles; i++) {
            const bundle = document.createElement("div");
            bundle.className = "cash-bundle";
            bundle.textContent = "100K";
            bundlesTableEl.appendChild(bundle);
        }
    }
    
    // Sync 3D Showcase cash bundles
    updateShowcaseBundles3D();
    
    const tubes = ["A", "B", "C", "D"];
    let totalTubes = 0;
    tubes.forEach(letter => {
        totalTubes += tubeBundles[letter];
        document.getElementById(`amount-${letter}`).textContent = formatMoney(tubeBundles[letter] * BUNDLE_VALUE);
    });
    
    // Hepsini topla butonunu güncelle (Şıklarda para varsa, oyun aktifse ve kilitli değilse aktifleşir)
    if (collectAllBtnEl) {
        const canCollect = gameActive && !isLocked && totalTubes > 0;
        collectAllBtnEl.disabled = !canCollect;
        if (!canCollect) {
            collectAllBtnEl.style.opacity = "0.4";
            collectAllBtnEl.style.pointerEvents = "none";
        } else {
            collectAllBtnEl.style.opacity = "1";
            collectAllBtnEl.style.pointerEvents = "auto";
        }
    }
    
    validateDistribution();
}

function validateDistribution() {
    const qData = activeGameQuestions[currentQuestionIndex];
    const optCount = qData.optionsCount || 4;
    
    // Aktif tüplerde para dağılım sayıları
    const activeTubesList = ["A", "B", "C", "D"].slice(0, optCount);
    const placedCounts = activeTubesList.map(letter => tubeBundles[letter]);
    const emptyTubesCount = placedCounts.filter(count => count === 0).length;
    const activeUsedTubesCount = placedCounts.filter(count => count > 0).length;
    
    const allMoneyDistributed = (tableBundles === 0);
    
    // Kural Denetimleri:
    // 1. Masada para kalmamalı
    // 2. Final Sorusu: Parayı bölmek yasak! Tek bir tüpe konulmalı.
    // 3. Normal Sorular: En az 1 tüp tamamen boş kalmalı.
    
    const isFinalQuestion = (currentQuestionIndex === configSettings.questionCount - 1);
    
    if (tableBundles > 0) {
        tableWarningEl.textContent = "Kasadaki tüm paraları şıklara dağıtmalısınız!";
        tableWarningEl.style.color = "var(--neon-gold)";
        tableWarningEl.style.textShadow = "var(--neon-gold-glow)";
        disableLock();
    } else if (isFinalQuestion && activeUsedTubesCount > 1) {
        tableWarningEl.textContent = "FİNAL KURALI: Son soruda paranızı bölemezsiniz! Hepsini tek şıkka koyun!";
        tableWarningEl.style.color = "var(--neon-red)";
        tableWarningEl.style.textShadow = "var(--neon-red-glow)";
        disableLock();
    } else if (!isFinalQuestion && emptyTubesCount < 1) {
        tableWarningEl.textContent = `Kural: En az 1 şık tamamen boş kalmalıdır!`;
        tableWarningEl.style.color = "var(--neon-red)";
        tableWarningEl.style.textShadow = "var(--neon-red-glow)";
        disableLock();
    } else {
        tableWarningEl.textContent = "Dağıtım kurallara uygun. Kilitleyebilirsiniz!";
        tableWarningEl.style.color = "var(--neon-green)";
        tableWarningEl.style.textShadow = "var(--neon-green-glow)";
        enableLock();
    }
}

function enableLock() {
    btnLockEl.disabled = false;
    btnLockEl.className = "btn-lock-active";
}

function disableLock() {
    btnLockEl.disabled = true;
    btnLockEl.className = "btn-lock-disabled";
}

let warningTimeout = null;
function displayTemporaryWarning(msg) {
    if (warningTimeout) clearTimeout(warningTimeout);
    tableWarningEl.textContent = msg;
    tableWarningEl.style.color = "var(--neon-red)";
    tableWarningEl.style.textShadow = "var(--neon-red-glow)";
    warningTimeout = setTimeout(() => {
        validateDistribution();
    }, 3000);
}

function checkCanAddMoney(letter) {
    const isFinalQuestion = (currentQuestionIndex === 12);
    const placedTubes = Object.keys(tubeBundles).filter(t => tubeBundles[t] > 0);
    
    if (isFinalQuestion) {
        if (placedTubes.length > 0 && !placedTubes.includes(letter)) {
            displayTemporaryWarning("FİNAL KURALI: Son soruda paranızı bölemezsiniz!");
            playWarningSound();
            return false;
        }
    } else {
        if (tubeBundles[letter] === 0 && placedTubes.length >= 3) {
            displayTemporaryWarning("KURAL: En az 1 şık tamamen boş kalmalıdır!");
            playWarningSound();
            return false;
        }
    }
    return true;
}

function playWarningSound() {
    if (isMuted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, audioCtx.currentTime);
    osc.frequency.linearRampToValueAtTime(80, audioCtx.currentTime + 0.15);
    
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

// Para Ekle - Çıkar
document.querySelectorAll(".btn-adjust").forEach(btn => {
    btn.addEventListener("click", (e) => {
        if (isLocked || !gameActive) return;
        
        const tube = e.target.getAttribute("data-target");
        const isPlus = e.target.classList.contains("btn-plus");
        
        if (isPlus) {
            if (tableBundles > 0) {
                if (!checkCanAddMoney(tube)) return;

                tableBundles--;
                tubeBundles[tube]++;
                addCashBundleToTube(tube); 
                playTickSound();
            }
        } else {
            if (tubeBundles[tube] > 0) {
                tubeBundles[tube]--;
                tableBundles++;
                removeCashBundleFromTube(tube); 
                playTickSound();
            }
        }
        
        updateMoneyUI();
    });
});

// Şık Kartlarına Tıklayarak Toplu Para Dağıtma (500K / 5 Balya birden)
document.querySelectorAll(".option-card").forEach(card => {
    card.addEventListener("click", () => {
        if (isLocked || !gameActive) return;
        
        const letter = card.getAttribute("data-option");
        
        // Aktif şıklar arasında mı kontrol et
        const qData = activeGameQuestions[currentQuestionIndex];
        const optCount = qData.optionsCount || 4;
        const letters = ["A", "B", "C", "D"].slice(0, optCount);
        if (!letters.includes(letter)) return;
        
        if (tableBundles > 0) {
            if (!checkCanAddMoney(letter)) return;

            const transferCount = Math.min(5, tableBundles);
            
            // Çift tıklama / yarış durumlarını önlemek için veriyi senkron düşür
            tableBundles -= transferCount;
            for (let i = 0; i < transferCount; i++) {
                tubeBundles[letter]++;
            }
            updateMoneyUI();
            
            // 3D Para animasyonlarını gecikmeli (staggered) fırlat
            for (let i = 0; i < transferCount; i++) {
                setTimeout(() => {
                    if (!gameActive) return;
                    addCashBundleToTube(letter);
                    playTickSound();
                }, i * 120);
            }
        }
    });
});

// Şıklardaki tüm paraları kasaya geri toplama fonksiyonu
function collectAllMoneyToTable() {
    if (isLocked || !gameActive) return;
    
    const letters = ["A", "B", "C", "D"];
    let totalCollected = 0;
    
    letters.forEach(letter => {
        if (tubeBundles[letter] > 0) {
            totalCollected += tubeBundles[letter];
            tubeBundles[letter] = 0;
            
            // 3D sahnede bu şıktaki tüm balyaları sil
            if (cashBundles3D[letter]) {
                cashBundles3D[letter].forEach(bundle => {
                    scene.remove(bundle);
                });
                cashBundles3D[letter] = [];
            }
        }
    });
    
    if (totalCollected > 0) {
        tableBundles += totalCollected;
        updateMoneyUI();
        playCashRegisterSound();
    }
}

// Hepsini topla butonu tıklama dinleyicisi
if (collectAllBtnEl) {
    collectAllBtnEl.addEventListener("click", () => {
        collectAllMoneyToTable();
    });
}

btnLockEl.addEventListener("click", () => {
    if (btnLockEl.disabled) return;
    
    if (isRevealedState) {
        // Sonraki soruya geçiş tetikle
        isRevealedState = false;
        disableLock();
        btnLockEl.textContent = "CEVABI KİLİTLE";
        processNextStep(savedCorrectLetter);
    } else {
        if (isLocked) return;
        lockAnswer();
    }
});

function startTimer() {
    clearInterval(timerInterval);
    timerSectionEl.classList.remove("warning");
    
    // Set initial width based on timeLeft
    const percent = (timeLeft / configSettings.timerDuration) * 100;
    timerProgressEl.style.width = `${percent}%`;
    timerTextEl.textContent = timeLeft;
    
    timerInterval = setInterval(() => {
        if (isTimerPaused) return; // Do not count down if paused
        
        timeLeft--;
        timerTextEl.textContent = timeLeft;
        
        const currentPercent = (timeLeft / configSettings.timerDuration) * 100;
        timerProgressEl.style.width = `${currentPercent}%`;
        
        if (timeLeft <= 10) {
            timerSectionEl.classList.add("warning");
            playTensionBeep();
        }
        
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            autoLockOnTimeout();
        }
    }, 1000);
}

function autoLockOnTimeout() {
    if (tableBundles > 0) {
        totalMoney -= (tableBundles * BUNDLE_VALUE);
        tableBundles = 0;
        updateMoneyUI();
    }
    lockAnswer();
}

function lockAnswer() {
    isLocked = true;
    clearInterval(timerInterval);
    stopTensionDrone();
    disableLock();
    
    // Lockdown pulse effects
    playLockdownPulseSound();
    shakeIntensity = 0.35;
    
    document.querySelectorAll(".btn-adjust").forEach(btn => btn.disabled = true);
    
    if (hostSpeechEl) {
        hostSpeechEl.textContent = "Cevaplar kilitlendi. Sonuçlar geliyor...";
    }
    
    // Cinematic Zoom (Tüpler daha geniş yayıldığı için biraz daha geriden ve yukarıdan bakıyoruz)
    cameraTargetPos.set(0, 3.0, 7.0);
    cameraTargetLookAt.set(0, 1.0, -1.0);
    
    const qData = activeGameQuestions[currentQuestionIndex];
    const correctLetter = qData.correctAnswer;
    
    // Kapakların açılması, sunucu konuşmasının bitmesini bekler
    hostSpeak("Cevaplar kilitlendi. Bakalım hangi şık doğru?", () => {
        setTimeout(() => {
            revealResults(correctLetter, qData.hostComment);
        }, 500); // Sunucu konuştuktan 500ms sonra kapaklar açılmaya başlar
    });
}

// Sonuç Açıklama
function revealResults(correctLetter, hostComment) {
    const qData = activeGameQuestions[currentQuestionIndex];
    const optCount = qData.optionsCount || 4;
    const letters = ["A", "B", "C", "D"].slice(0, optCount);
    
    let correctTubHasMoney = tubeBundles[correctLetter] > 0;
    let prevTotalMoney = totalMoney;
    let keptMoney = tubeBundles[correctLetter] * BUNDLE_VALUE;
    
    const wrongLetters = letters.filter(l => l !== correctLetter);
    
    // Yanlış kapakları sırayla tek tek açan fonksiyon
    function openWrongDoorSequentially(index) {
        if (index >= wrongLetters.length) {
            // Tüm yanlış kapaklar açıldıktan sonra doğru şıkkı açıkla
            revealCorrectAnswer();
            return;
        }
        
        const letter = wrongLetters[index];
        
        // 2D Şık Kartını ve 3D Pedestalı renklendir
        const optionEl = document.querySelector(`.option-card[data-option="${letter}"]`);
        if (optionEl) {
            optionEl.classList.add("wrong-answer");
        }
        if (cylinders3D[letter + "_neon"]) {
            cylinders3D[letter + "_neon"].material.color.setHex(0xff0055); // Kırmızı neon
        }
        
        const tubeContainer = document.getElementById(`tube-container-${letter}`);
        if (tubeContainer) {
            tubeContainer.classList.add("wrong");
        }
        
        animateHatchOpenAndDrop(letter);
        
        // Bir sonraki yanlış kapağı açmak için 2.4 saniye bekle (yavaş açılış ve paranın düşüşü için tam süre)
        setTimeout(() => {
            openWrongDoorSequentially(index + 1);
        }, 2400);
    }
    
    // Doğru cevabı açıklama ve sunucu konuşması
    function revealCorrectAnswer() {
        // Doğru şık kartını ve pedestalı renklendir
        const optionEl = document.querySelector(`.option-card[data-option="${correctLetter}"]`);
        if (optionEl) {
            optionEl.classList.add("correct-answer");
        }
        if (cylinders3D[correctLetter + "_neon"]) {
            cylinders3D[correctLetter + "_neon"].material.color.setHex(0x39ff14); // Yeşil neon
        }
        
        const tubeContainer = document.getElementById(`tube-container-${correctLetter}`);
        if (tubeContainer) {
            tubeContainer.classList.add("correct");
        }
        
        let voicePrefix = "";
        let speechText = "";
        
        if (correctTubHasMoney) {
            playApplauseSound();
            hostAction = "happy";
            
            // Kamera geniş açıya odaklansın
            cameraTargetPos.set(0, 4.0, 9.0);
            cameraTargetLookAt.set(0, 1.0, -1.0);
            
            if (keptMoney === prevTotalMoney) {
                voicePrefix = "Harika! Müthiş bir tahminle paranızın tamamını korudunuz! ";
            } else {
                voicePrefix = "Tebrikler! Paranızı bölerek bir kısmını kurtarmayı başardınız. ";
            }
            speechText = voicePrefix + hostComment;
        } else {
            playDisappointmentSound();
            hostAction = "sad";
            
            // Kamera geniş açıya odaklansın
            cameraTargetPos.set(0, 4.0, 9.0);
            cameraTargetLookAt.set(0, 1.0, -1.0);
            
            speechText = `Maalesef tüm paranızı kaybettiniz! Doğru cevap ${correctLetter} şıkkı olmalıydı. ${hostComment}`;
        }
        
        // Ekranda doğru cevabı ve açıklamayı göster
        if (questionTextEl) {
            questionTextEl.innerHTML = `<span style="color: var(--neon-green); font-weight: 800; font-size: 0.95rem;">DOĞRU CEVAP: ${correctLetter}</span><br/><br/><span style="color: var(--neon-gold); font-weight: 800; font-size: 0.85rem;">AÇIKLAMA:</span> <span style="font-size: 0.8rem; font-weight: 400; line-height: 1.4; text-shadow: none;">${hostComment || 'Açıklama bulunamadı.'}</span>`;
        }

        if (hostSpeechEl) {
            hostSpeechEl.textContent = speechText;
        }
        
        // Kilitle butonunu "AÇIKLANIYOR..." durumuna getir
        btnLockEl.textContent = "AÇIKLANIYOR...";
        btnLockEl.disabled = true;
        btnLockEl.className = "btn-lock-disabled";
        
        isRevealedState = true;
        savedCorrectLetter = correctLetter;
        
        const startSpeakTime = Date.now();
        hostSpeak(speechText, () => {
            const elapsed = Date.now() - startSpeakTime;
            const remaining = Math.max(0, 1500 - elapsed);
            // Okuma bittikten veya en az 1.5 saniye sonra sonraki adıma geç
            setTimeout(() => {
                if (!gameActive) return;
                
                if (keptMoney <= 0) {
                    // Eğer eldeki para tükendiyse (kaybedildiyse), bir sonraki soru butonu gösterilmez
                    // Doğrudan kaybetme ekranı geçişi yapılır
                    processNextStep(correctLetter);
                } else {
                    btnLockEl.textContent = "SONRAKİ SORUYA GEÇ";
                    btnLockEl.className = "btn-next-active";
                    btnLockEl.disabled = false;
                }
            }, remaining);
        });
    }
    
    // İlk yanlış kapağı açarak zinciri başlat
    openWrongDoorSequentially(0);
}

function processNextStep(correctLetter) {
    totalMoney = tubeBundles[correctLetter] * BUNDLE_VALUE;
    totalMoneyTextEl.textContent = formatMoney(totalMoney);
    
    document.querySelectorAll(".btn-adjust").forEach(btn => btn.disabled = false);
    
    if (totalMoney <= 0) {
        gameActive = false;
        hostAction = "sad";
        const reachedQNum = currentQuestionIndex + 1;
        gameoverReachedQuestionEl.textContent = `${reachedQNum}. Soru`;
        gameoverModalEl.classList.remove("hidden");
        
        // Submit score to API
        submitScore(0, reachedQNum);
    } else if (currentQuestionIndex === activeGameQuestions.length - 1) {
        gameActive = false;
        hostAction = "happy";
        winAmountTextEl.textContent = formatMoney(totalMoney);
        
        // Spawn victory confetti
        spawnConfetti();
        
        // Show victory modal directly
        victoryModalEl.classList.remove("hidden");
        
        // Submit score to API (dynamic questionCount completed)
        submitScore(totalMoney, configSettings.questionCount);
    } else {
        currentQuestionIndex++;
        loadQuestion(currentQuestionIndex);
    }
}

function formatMoney(amount) {
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " TL";
}

// ================= SES EFEKTLERİ (Web Audio API) =================

function playTickSound() {
    if (isMuted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function playDropSound() {
    if (isMuted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.frequency.setValueAtTime(140, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, audioCtx.currentTime + 0.4);
    
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}

function playTensionBeep() {
    if (isMuted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(500, audioCtx.currentTime);
    
    gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
}

// Kapak Açılma Sesi (Metal Clank)
function playHatchOpenSound() {
    if (isMuted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(45, audioCtx.currentTime + 0.4);
    
    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.44);
}

function startTensionDrone() {
    // Tension drone has been removed as per user request to eliminate background crackling/buzzing noises.
}

function stopTensionDrone() {
    if (!tensionOsc) return;
    tensionGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    setTimeout(() => {
        if (tensionOsc) {
            tensionOsc.stop();
            tensionOsc = null;
            tensionGain = null;
        }
    }, 600);
}

function playApplauseSound() {
    if (isMuted) return;
    const bufferSize = audioCtx.sampleRate * 2.5; 
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    
    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = buffer;
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, audioCtx.currentTime);
    filter.Q.setValueAtTime(1.5, audioCtx.currentTime);
    
    const gainNode = audioCtx.createGain();
    
    gainNode.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.18, audioCtx.currentTime + 0.3); 
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2.4); 
    
    noiseNode.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    noiseNode.start();
    
    for (let t = 0; t < 20; t++) {
        setTimeout(() => {
            playIndividualClap();
        }, 100 + Math.random() * 1500);
    }
}

function playIndividualClap() {
    if (isMuted) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150 + Math.random() * 300, audioCtx.currentTime);
    
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.06);
}

function playDisappointmentSound() {
    if (isMuted) return;
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    
    osc1.frequency.setValueAtTime(110, audioCtx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(75, audioCtx.currentTime + 1.2);
    
    osc2.frequency.setValueAtTime(108, audioCtx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(73, audioCtx.currentTime + 1.2);
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(160, audioCtx.currentTime);
    
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    gainNode.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 0.2);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.4);
    
    osc1.start();
    osc2.start();
    
    osc1.stop(audioCtx.currentTime + 1.5);
    osc2.stop(audioCtx.currentTime + 1.5);
}

// Yazar Kasa / Para Toplama Sesi (Cash Register / Sweep SFX)
function playCashRegisterSound() {
    if (isMuted) return;
    const now = audioCtx.currentTime;

    // 1. High Pitch Metallic Bell (Ting)
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainBell = audioCtx.createGain();
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1400, now);
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2000, now); // Harmonik

    gainBell.gain.setValueAtTime(0.12, now);
    gainBell.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc1.connect(gainBell);
    osc2.connect(gainBell);
    gainBell.connect(audioCtx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.45);
    osc2.stop(now + 0.45);

    // 2. Coins Slide (Sweep/Sizzle)
    const bufferSize = audioCtx.sampleRate * 0.25; // 0.25s
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(250, now + 0.25); // Sweep down
    filter.Q.setValueAtTime(1.8, now);

    const gainNoise = audioCtx.createGain();
    gainNoise.gain.setValueAtTime(0.001, now);
    gainNoise.gain.linearRampToValueAtTime(0.08, now + 0.04);
    gainNoise.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    noise.connect(filter);
    filter.connect(gainNoise);
    gainNoise.connect(audioCtx.destination);

    noise.start(now);
    noise.stop(now + 0.3);
}

// Kilitlenme Anı Bas Pulsü (Lockdown Pulse SFX)
function playLockdownPulseSound() {
    if (isMuted) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const oscSub = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.7);

    oscSub.type = 'sine';
    oscSub.frequency.setValueAtTime(50, now);
    oscSub.frequency.exponentialRampToValueAtTime(20, now + 0.9);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(100, now);

    gainNode.gain.setValueAtTime(0.35, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    osc.connect(filter);
    oscSub.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.start(now);
    oscSub.start(now);
    osc.stop(now + 0.95);
    oscSub.stop(now + 0.95);
}


