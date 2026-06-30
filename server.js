const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { Readable } = require('stream');

// Load environment variables
dotenv.config();

const settingsFilePath = path.join(__dirname, 'settings.json');
let gameSettings = {
    timerDuration: 60,
    startingMoney: 2000000,
    questionCount: 13,
    announcement: "IOWF MİLYON'a hoş geldiniz! Kasadaki paranızı korumak için yarışın."
};

// Check if Vercel KV is enabled (supports KV_ and STORAGE_ prefixes)
const kvUrl = process.env.STORAGE_REST_API_URL || process.env.KV_REST_API_URL;
const kvToken = process.env.STORAGE_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;
const isKvEnabled = !!(kvUrl && kvToken);

console.log(`Vercel KV Integration: ${isKvEnabled ? "ENABLED" : "DISABLED (using local file fallback)"}`);

async function kvCmd(command, ...args) {
    if (!isKvEnabled) return null;
    try {
        const response = await fetch(`${kvUrl}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${kvToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify([command, ...args])
        });
        if (!response.ok) {
            const errText = await response.text();
            console.error(`Vercel KV error: ${response.status} - ${errText}`);
            return null;
        }
        const res = await response.json();
        return res.result;
    } catch (e) {
        console.error("Vercel KV request failed:", e.message);
        return null;
    }
}

async function saveSettingsToDisk() {
    if (isKvEnabled) {
        await kvCmd('SET', 'game_settings', JSON.stringify(gameSettings));
    }
    try {
        fs.writeFileSync(settingsFilePath, JSON.stringify(gameSettings, null, 4), 'utf8');
    } catch (err) {
        console.warn("Could not save settings.json to disk (likely serverless/read-only env):", err.message);
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Serve static frontend files
app.use(express.static(path.join(__dirname)));

// Load questions from questions.txt into memory pools
let CAT_4 = [];
let CAT_3 = [];
let CAT_2 = [];
let FINAL = [];

function loadQuestionsFromLocalFile() {
    try {
        const code = fs.readFileSync(path.join(__dirname, 'questions.txt'), 'utf8');
        const sandbox = {};
        vm.createContext(sandbox);
        const codeWithExports = code + `
        ;
        globalThis.CAT_4_QUESTIONS = CAT_4_QUESTIONS;
        globalThis.CAT_3_QUESTIONS = CAT_3_QUESTIONS;
        globalThis.CAT_2_QUESTIONS = CAT_2_QUESTIONS;
        globalThis.FINAL_QUESTIONS_POOL = FINAL_QUESTIONS_POOL;
        `;
        vm.runInContext(codeWithExports, sandbox);

        CAT_4 = sandbox.CAT_4_QUESTIONS || [];
        CAT_3 = sandbox.CAT_3_QUESTIONS || [];
        CAT_2 = sandbox.CAT_2_QUESTIONS || [];
        FINAL = sandbox.FINAL_QUESTIONS_POOL || [];
        console.log(`Loaded default questions from questions.txt: CAT_4: ${CAT_4.length}, CAT_3: ${CAT_3.length}, CAT_2: ${CAT_2.length}, FINAL: ${FINAL.length}`);
    } catch (err) {
        console.error("Failed to load questions.txt:", err.message);
    }
}

async function saveQuestionsToDisk() {
    if (isKvEnabled) {
        await kvCmd('SET', 'game_questions', JSON.stringify({ CAT_4, CAT_3, CAT_2, FINAL }));
    }
    const code = `// IOWF MİLYON - KATEGORİZE EDİLMİŞ SORU HAVUZLARI\n\n` +
                 `// Kategori 1: 4 Şıklı Sorular (Seçenekler: A, B, C, D)\n` +
                 `const CAT_4_QUESTIONS = ${JSON.stringify(CAT_4, null, 4)};\n\n` +
                 `// Kategori 2: 3 Şıklı Sorular (Seçenekler: A, B, C)\n` +
                 `const CAT_3_QUESTIONS = ${JSON.stringify(CAT_3, null, 4)};\n\n` +
                 `// Kategori 3: 2 Şıklı Sorular (Seçenekler: A, B)\n` +
                 `const CAT_2_QUESTIONS = ${JSON.stringify(CAT_2, null, 4)};\n\n` +
                 `// Kategori 4: Final Havuzu (2 Seçenek - Bölme Yasak)\n` +
                 `const FINAL_QUESTIONS_POOL = ${JSON.stringify(FINAL, null, 4)};\n`;
    try {
        fs.writeFileSync(path.join(__dirname, 'questions.txt'), code, 'utf8');
    } catch (err) {
        console.warn("Could not save questions.txt to disk (likely serverless/read-only env):", err.message);
    }
}

// Fisher-Yates Shuffle
function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// ================= API ENDPOINTS =================

// 1. Get Shuffled Game Questions (drawn from the unified 4-option pool based on settings)
app.get('/api/questions', (req, res) => {
    try {
        const count = Math.min(gameSettings.questionCount || 13, CAT_4.length);
        const selected = shuffleArray(CAT_4).slice(0, count);
        const formatted = selected.map((q, idx) => {
            return {
                id: idx + 1,
                question: q.question,
                options: q.options,
                correctAnswer: q.correctAnswer,
                optionsCount: 4, // always 4 options
                hostComment: q.hostComment
            };
        });
        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. TTS Voice Proxy (Fish Audio, ElevenLabs, or Google TTS fallback)
app.post('/api/speak', async (req, res) => {
    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ error: "Text is required" });
    }

    const fishKey = process.env.FISH_AUDIO_API_KEY;
    const elevenKey = process.env.ELEVEN_LABS_API_KEY;
    const googleKey = process.env.GOOGLE_TTS_API_KEY;

    if (fishKey) {
        try {
            const voiceId = process.env.FISH_AUDIO_VOICE_ID || ""; // reference_id
            const modelName = process.env.FISH_AUDIO_MODEL || "s2.1-pro-free";
            
            const response = await fetch('https://api.fish.audio/v1/tts', {
                method: 'POST',
                body: JSON.stringify({
                    text: text,
                    format: "mp3",
                    ...(voiceId ? { reference_id: voiceId } : {})
                }),
                headers: {
                    'Authorization': `Bearer ${fishKey}`,
                    'Content-Type': 'application/json',
                    'model': modelName
                }
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Fish Audio error: ${response.status} - ${errText}`);
            }

            res.set({
                'Content-Type': 'audio/mpeg',
                'Transfer-Encoding': 'chunked'
            });

            const nodeStream = Readable.fromWeb(response.body);
            nodeStream.pipe(res);
        } catch (error) {
            console.error("Fish Audio error:", error.message);
            res.status(500).json({ error: "Fish Audio synthesis failed: " + error.message });
        }
    } else if (elevenKey) {
        try {
            const voiceId = process.env.ELEVEN_LABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // default female Rachel
            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
                method: 'POST',
                body: JSON.stringify({
                    text: text,
                    model_id: "eleven_multilingual_v2",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                }),
                headers: {
                    'xi-api-key': elevenKey,
                    'accept': 'audio/mpeg',
                    'content-type': 'application/json'
                }
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`ElevenLabs error: ${response.status} - ${errText}`);
            }

            res.set({
                'Content-Type': 'audio/mpeg',
                'Transfer-Encoding': 'chunked'
            });

            const nodeStream = Readable.fromWeb(response.body);
            nodeStream.pipe(res);
        } catch (error) {
            console.error("ElevenLabs error:", error.message);
            res.status(500).json({ error: "ElevenLabs synthesis failed: " + error.message });
        }
    } else if (googleKey) {
        try {
            const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleKey}`, {
                method: 'POST',
                body: JSON.stringify({
                    input: { text: text },
                    voice: { languageCode: 'tr-TR', name: 'tr-TR-Wavenet-C' },
                    audioConfig: { audioEncoding: 'MP3' }
                }),
                headers: {
                    'content-type': 'application/json'
                }
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Google TTS error: ${response.status} - ${errText}`);
            }

            const data = await response.json();
            const audioBuffer = Buffer.from(data.audioContent, 'base64');
            res.set({
                'Content-Type': 'audio/mpeg',
                'Content-Length': audioBuffer.length
            });
            res.send(audioBuffer);
        } catch (error) {
            console.error("Google TTS error:", error.message);
            res.status(500).json({ error: "Google TTS synthesis failed: " + error.message });
        }
    } else {
        // Fallback to client Web Speech API
        res.json({ fallback: true, msg: "No API Key configured. Fallback to browser SpeechSynthesis." });
    }
});

// ================= SCOREBOARD ENDPOINTS =================

const scoresFilePath = path.join(__dirname, 'scores.json');
let memoryScores = [];

async function saveScoresToDisk() {
    if (isKvEnabled) {
        await kvCmd('SET', 'game_scores', JSON.stringify(memoryScores));
    }
    try {
        fs.writeFileSync(scoresFilePath, JSON.stringify(memoryScores, null, 4), 'utf8');
    } catch (writeErr) {
        console.warn("Could not persist scores to disk (likely serverless/read-only env):", writeErr.message);
    }
}

// Database Seeder & Initializer functions
async function initConfig() {
    if (isKvEnabled) {
        try {
            const cached = await kvCmd('GET', 'game_settings');
            if (cached) {
                gameSettings = JSON.parse(cached);
                console.log("Settings loaded from Vercel KV successfully!");
            } else {
                await kvCmd('SET', 'game_settings', JSON.stringify(gameSettings));
                console.log("Seeded Vercel KV with initial game settings");
            }
        } catch (e) {
            console.error("Failed to fetch settings from Vercel KV:", e.message);
        }
    }
}

async function initQuestions() {
    loadQuestionsFromLocalFile();
    if (isKvEnabled) {
        try {
            const cached = await kvCmd('GET', 'game_questions');
            if (cached) {
                const parsed = JSON.parse(cached);
                CAT_4 = parsed.CAT_4 || [];
                CAT_3 = parsed.CAT_3 || [];
                CAT_2 = parsed.CAT_2 || [];
                FINAL = parsed.FINAL || [];
                console.log(`Questions successfully synced from Vercel KV: CAT_4: ${CAT_4.length}, CAT_3: ${CAT_3.length}, CAT_2: ${CAT_2.length}, FINAL: ${FINAL.length}`);
            } else {
                await kvCmd('SET', 'game_questions', JSON.stringify({ CAT_4, CAT_3, CAT_2, FINAL }));
                console.log("Seeded Vercel KV with initial questions list");
            }
        } catch (e) {
            console.error("Failed to sync questions with Vercel KV:", e.message);
        }
    }
}

async function initScores() {
    try {
        if (fs.existsSync(scoresFilePath)) {
            const fileContent = fs.readFileSync(scoresFilePath, 'utf8');
            memoryScores = JSON.parse(fileContent || '[]');
        }
    } catch (e) {
        console.warn("Failed to pre-populate memory scores from disk:", e.message);
    }

    if (isKvEnabled) {
        try {
            const cached = await kvCmd('GET', 'game_scores');
            if (cached) {
                memoryScores = JSON.parse(cached);
                console.log(`Scores successfully synced from Vercel KV: ${memoryScores.length} records`);
            } else {
                await kvCmd('SET', 'game_scores', JSON.stringify(memoryScores));
                console.log("Seeded Vercel KV with initial scores list");
            }
        } catch (e) {
            console.error("Failed to sync scores with Vercel KV:", e.message);
        }
    }
}

async function initAll() {
    await initConfig();
    await initQuestions();
    await initScores();
}

initAll().catch(err => console.error("Database initialization failed:", err.message));

// Get high scores
app.get('/api/scores', (req, res) => {
    try {
        let scores = memoryScores;
        
        // Deduplicate: Keep only the best score per user
        const userBestScores = {};
        scores.forEach(s => {
            if (!s.username) return;
            const username = s.username.trim();
            const money = parseInt(s.money, 10) || 0;
            const questionReached = parseInt(s.questionReached, 10) || 0;
            
            if (!userBestScores[username]) {
                userBestScores[username] = s;
            } else {
                const existing = userBestScores[username];
                const existingMoney = parseInt(existing.money, 10) || 0;
                const existingQuestion = parseInt(existing.questionReached, 10) || 0;
                
                if (money > existingMoney) {
                    userBestScores[username] = s;
                } else if (money === existingMoney && questionReached > existingQuestion) {
                    userBestScores[username] = s;
                }
            }
        });
        
        const sortedScores = Object.values(userBestScores).sort((a, b) => {
            const moneyA = parseInt(a.money, 10) || 0;
            const moneyB = parseInt(b.money, 10) || 0;
            if (moneyB !== moneyA) {
                return moneyB - moneyA;
            }
            const qA = parseInt(a.questionReached, 10) || 0;
            const qB = parseInt(b.questionReached, 10) || 0;
            return qB - qA;
        });
        
        // Limit to top 20
        res.json(sortedScores.slice(0, 20));
    } catch (err) {
        console.error("Failed to read scores:", err.message);
        // Fallback to memory
        res.json(memoryScores.slice(0, 20));
    }
});

// Submit a new score
app.post('/api/scores', async (req, res) => {
    try {
        const { username, money, questionReached } = req.body;
        if (!username || username.trim() === '') {
            return res.status(400).json({ error: 'Username is required' });
        }
        
        const newScore = {
            username: username.trim(),
            money: parseInt(money, 10) || 0,
            questionReached: parseInt(questionReached, 10) || 0,
            date: new Date().toISOString()
        };
        
        memoryScores.push(newScore);
        await saveScoresToDisk();
        
        res.json({ success: true, newScore });
    } catch (err) {
        console.error("Failed to write score:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ================= ADMIN PANEL ENDPOINTS =================

// Reset (clear) all scores
app.delete('/api/admin/scores', checkAdminAuth, async (req, res) => {
    try {
        memoryScores = [];
        await saveScoresToDisk();
        res.json({ success: true, msg: 'Sıralama tablosu başarıyla sıfırlandı!' });
    } catch (err) {
        console.error("Failed to reset scores:", err.message);
        res.status(500).json({ error: 'Sıralama sıfırlanamadı: ' + err.message });
    }
});

// Get all scores (for admin view/delete)
app.get('/api/admin/scores', checkAdminAuth, (req, res) => {
    try {
        const sorted = [...memoryScores].sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(sorted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a specific score by username and date
app.delete('/api/admin/scores/:username/:date', checkAdminAuth, async (req, res) => {
    try {
        const username = decodeURIComponent(req.params.username).trim();
        const date = decodeURIComponent(req.params.date).trim();
        
        const initialLength = memoryScores.length;
        memoryScores = memoryScores.filter(s => !(s.username.trim() === username && s.date.trim() === date));
        
        if (memoryScores.length < initialLength) {
            await saveScoresToDisk();
            res.json({ success: true, msg: 'Skor kaydı başarıyla silindi!' });
        } else {
            res.status(404).json({ error: 'Eşleşen skor kaydı bulunamadı!' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get game settings
app.get('/api/settings', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json(gameSettings);
});

// Update game settings
app.post('/api/admin/settings', checkAdminAuth, async (req, res) => {
    try {
        const { timerDuration, startingMoney, questionCount, announcement } = req.body;
        
        if (timerDuration !== undefined) gameSettings.timerDuration = parseInt(timerDuration, 10) || 60;
        if (startingMoney !== undefined) gameSettings.startingMoney = parseInt(startingMoney, 10) || 2000000;
        if (questionCount !== undefined) gameSettings.questionCount = parseInt(questionCount, 10) || 13;
        if (announcement !== undefined) gameSettings.announcement = String(announcement);
        
        await saveSettingsToDisk();
        res.json({ success: true, settings: gameSettings, msg: 'Ayarlar başarıyla kaydedildi!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Test Fish Audio Connection
app.post('/api/admin/test-fish-audio', checkAdminAuth, async (req, res) => {
    const fishKey = process.env.FISH_AUDIO_API_KEY;
    const voiceId = process.env.FISH_AUDIO_VOICE_ID || "";
    
    if (!fishKey) {
        return res.status(400).json({ error: "Fish Audio API Key sistemde tanımlı değil (.env dosyasını kontrol edin)." });
    }
    
    try {
        const response = await fetch('https://api.fish.audio/v1/tts', {
            method: 'POST',
            body: JSON.stringify({
                text: "Test",
                format: "mp3",
                ...(voiceId ? { reference_id: voiceId } : {})
            }),
            headers: {
                'Authorization': `Bearer ${fishKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            res.json({ success: true, msg: "Fish Audio bağlantısı başarılı!" });
        } else {
            const errText = await response.text();
            res.status(response.status).json({ error: `Fish Audio Hatası: ${response.status} - ${errText}` });
        }
    } catch (err) {
        res.status(500).json({ error: `Bağlantı Hatası: ${err.message}` });
    }
});

// Edit existing question
app.put('/api/admin/questions/:category/:index', checkAdminAuth, async (req, res) => {
    const { category, index } = req.params;
    const idx = parseInt(index, 10);
    const { question, options, correctAnswer, optionsCount, hostComment } = req.body;
    
    if (!question || !options || !correctAnswer || !optionsCount) {
        return res.status(400).json({ error: 'Eksik alanlar var!' });
    }
    
    let targetArray;
    switch (category) {
        case 'CAT_4': targetArray = CAT_4; break;
        case 'CAT_3': targetArray = CAT_3; break;
        case 'CAT_2': targetArray = CAT_2; break;
        case 'FINAL': targetArray = FINAL; break;
        default: return res.status(400).json({ error: 'Geçersiz kategori!' });
    }
    
    if (isNaN(idx) || idx < 0 || idx >= targetArray.length) {
        return res.status(400).json({ error: 'Geçersiz soru indeksi!' });
    }
    
    targetArray[idx] = {
        question,
        options,
        correctAnswer,
        optionsCount: parseInt(optionsCount, 10),
        hostComment: hostComment || ""
    };
    
    try {
        await saveQuestionsToDisk();
        res.json({ success: true, msg: 'Soru başarıyla güncellendi!' });
    } catch (err) {
        res.status(500).json({ error: 'Dosyaya kaydedilemedi: ' + err.message });
    }
});

// Redirect/serve /admin to admin.html
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Admin auth middleware
function checkAdminAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (authHeader === '3131') {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized: Geçersiz şifre!' });
    }
}

// Get raw lists of questions
app.get('/api/admin/questions', checkAdminAuth, (req, res) => {
    res.json({
        CAT_4,
        CAT_3,
        CAT_2,
        FINAL
    });
});

// Add question
app.post('/api/admin/questions', checkAdminAuth, async (req, res) => {
    const { category, question, options, correctAnswer, optionsCount, hostComment } = req.body;
    if (!category || !question || !options || !correctAnswer || !optionsCount) {
        return res.status(400).json({ error: 'Eksik alanlar var!' });
    }

    const newQuestion = {
        question,
        options,
        correctAnswer,
        optionsCount: parseInt(optionsCount, 10),
        hostComment: hostComment || ""
    };

    switch (category) {
        case 'CAT_4':
            CAT_4.push(newQuestion);
            break;
        case 'CAT_3':
            CAT_3.push(newQuestion);
            break;
        case 'CAT_2':
            CAT_2.push(newQuestion);
            break;
        case 'FINAL':
            FINAL.push(newQuestion);
            break;
        default:
            return res.status(400).json({ error: 'Geçersiz kategori!' });
    }

    try {
        await saveQuestionsToDisk();
        res.json({ success: true, msg: 'Soru başarıyla eklendi!' });
    } catch (err) {
        res.status(500).json({ error: 'Dosyaya kaydedilemedi: ' + err.message });
    }
});

// Delete question
app.delete('/api/admin/questions/:category/:index', checkAdminAuth, async (req, res) => {
    const { category, index } = req.params;
    const idx = parseInt(index, 10);

    let targetArray;
    switch (category) {
        case 'CAT_4':
            targetArray = CAT_4;
            break;
        case 'CAT_3':
            targetArray = CAT_3;
            break;
        case 'CAT_2':
            targetArray = CAT_2;
            break;
        case 'FINAL':
            targetArray = FINAL;
            break;
        default:
            return res.status(400).json({ error: 'Geçersiz kategori!' });
    }

    if (isNaN(idx) || idx < 0 || idx >= targetArray.length) {
        return res.status(400).json({ error: 'Geçersiz soru indeksi!' });
    }

    targetArray.splice(idx, 1);

    try {
        await saveQuestionsToDisk();
        res.json({ success: true, msg: 'Soru başarıyla silindi!' });
    } catch (err) {
        res.status(500).json({ error: 'Dosyaya kaydedilemedi: ' + err.message });
    }
});

// Start Server (only if not running on Vercel as a Serverless function)
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`IOWF Milyon Backend Server is running at http://localhost:${PORT}`);
    });
}

module.exports = app;
