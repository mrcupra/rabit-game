// game.js — الأرنوبة الشقية 🐰🥕 (v10 Mega Online Edition)
// - سباقات أونلاين متعددة اللاعبين + غرف خاصة + نظام Ghosts ذكي
// - شحن الجواهر 💎 + أكواد الهدايا + صناديق الحظ + الباتل باس + عجلة الحظ + المكافآت اليومية
// - الطور اللانهائي ♾️ + معارك الزعماء 🐉 + الحيوانات الأليفة 🐾 + الزلاجات 🛹 + آثار الجري ✨ + المهارات الخارقة 💥 + بوابات الحمى 🌈
// - نظام العشائر 🛡️ + المهام والإنجازات 📜 + الإنعاش الفوري بالجواهر 💖 + الموسيقى التفاعلية 🎵
(function () {
    'use strict';

    // ==================== 1. DEVICE & CAPABILITY DETECTION ====================
    let isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (isTouchDevice) {
        document.documentElement.classList.add('is-touch');
    }
    window.addEventListener('touchstart', () => {
        if (!isTouchDevice) {
            isTouchDevice = true;
            document.documentElement.classList.add('is-touch');
            if (typeof touchControlsEl !== 'undefined' && touchControlsEl) {
                touchControlsEl.classList.toggle('hidden', state !== 'PLAYING');
            }
        }
    }, { once: true, passive: true });

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    function escHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function drawRoundRect(context, x, y, w, h, r) {
        if (typeof context.roundRect === 'function') {
            context.beginPath();
            context.roundRect(x, y, w, h, r);
            return;
        }
        const radius = Math.min(r, w / 2, h / 2);
        context.beginPath();
        context.moveTo(x + radius, y);
        context.arcTo(x + w, y, x + w, y + h, radius);
        context.arcTo(x + w, y + h, x, y + h, radius);
        context.arcTo(x, y + h, x, y, radius);
        context.arcTo(x, y, x + w, y, radius);
        context.closePath();
    }

    // ==================== 2. ASSETS & iOS-SAFE AUDIO + PROCEDURAL BGM ====================
    const ASSETS = window.GAME_ASSETS || {};
    const stickerFaceImg = new Image();
    const stickerFullImg = new Image();
    const heroCompositeImg = new Image();

    if (ASSETS.sticker_face) stickerFaceImg.src = ASSETS.sticker_face;
    if (ASSETS.sticker_full) stickerFullImg.src = ASSETS.sticker_full;
    if (ASSETS.hero_composite) heroCompositeImg.src = ASSETS.hero_composite;
    stickerFaceImg.onload = () => {
        if (typeof renderHub === 'function' && currentUser) renderHub();
    };

    function applyStaticImages() {
        const map = {
            'auth-hero-img': ASSETS.hero_composite || 'assets/hero_composite.png',
            'intro-hero-img': ASSETS.hero_composite || 'assets/hero_composite.png',
            'hub-avatar': ASSETS.hero_composite || 'assets/hero_composite.png',
            'result-img': ASSETS.sticker_full || 'assets/sticker_full.png'
        };
        Object.keys(map).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.src = map[id];
        });
    }
    applyStaticImages();

    let isMuted = false;
    let bgmEnabled = true;
    let audioCtx = null;
    let audioUnlocked = false;
    let bgmStep = 0;
    let bgmInterval = null;

    const voiceWinAudio = new Audio(ASSETS.voice_congrats || 'assets/voice_congrats.mp3');
    const voiceLoseAudio = new Audio(ASSETS.voice_lose || 'assets/voice_lose.mp3');
    voiceWinAudio.preload = 'auto';
    voiceLoseAudio.preload = 'auto';

    function unlockAudio() {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) audioCtx = new AC();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        if (!audioUnlocked) {
            audioUnlocked = true;
            [voiceWinAudio, voiceLoseAudio].forEach(aud => {
                try {
                    aud.muted = true;
                    const p = aud.play();
                    if (p && typeof p.then === 'function') {
                        p.then(() => {
                            aud.pause();
                            aud.currentTime = 0;
                            aud.muted = false;
                        }).catch(() => { aud.muted = false; });
                    } else {
                        aud.muted = false;
                    }
                } catch (e) { aud.muted = false; }
            });
        }
    }

    ['touchstart', 'pointerdown', 'keydown'].forEach(evt => {
        window.addEventListener(evt, unlockAudio, { once: true, passive: true });
    });

    function playTone(freq, type, duration, vol = 0.16, slideTo = null) {
        if (isMuted || !audioCtx) return;
        try {
            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, now);
            if (slideTo) {
                osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
            }
            gain.gain.setValueAtTime(vol, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.onended = () => {
                try { osc.disconnect(); gain.disconnect(); } catch (e) {}
            };
            osc.start(now);
            osc.stop(now + duration);
        } catch (e) {}
    }

    // Procedural WebAudio Arcade Soundtrack
    const BGM_NOTES = [261.63, 329.63, 392.00, 523.25, 392.00, 329.63, 293.66, 349.23, 440.00, 523.25, 440.00, 392.00];
    const BGM_BOSS = [196.00, 233.08, 261.63, 293.66, 261.63, 233.08, 174.61, 196.00];

    function startBGM() {
        stopBGM();
        if (!bgmEnabled || isMuted) return;
        bgmInterval = setInterval(() => {
            if (state !== 'PLAYING' || isMuted || !bgmEnabled || !audioCtx || isPortraitBlocked) return;
            const seq = (gameMode === 'boss' || bossEntity) ? BGM_BOSS : BGM_NOTES;
            const note = seq[bgmStep % seq.length];
            const mult = feverTimer > 0 ? 1.25 : 1.0;
            playTone(note * mult, 'triangle', 0.13, 0.045);
            if (bgmStep % 2 === 0) {
                playTone(note * 0.5, 'sine', 0.15, 0.04);
            }
            bgmStep++;
        }, 175);
    }

    function stopBGM() {
        if (bgmInterval) {
            clearInterval(bgmInterval);
            bgmInterval = null;
        }
    }

    let lastCarrotSfxAt = 0;
    function sfxCarrot(comboVal = 1) {
        const nowMs = performance.now();
        if (nowMs - lastCarrotSfxAt < 48) return;
        lastCarrotSfxAt = nowMs;
        const base = 580 + Math.min(comboVal * 30, 380);
        playTone(base, 'sine', 0.09, 0.16, base * 1.35);
    }

    function sfxPowerup() {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
            setTimeout(() => playTone(f, 'triangle', 0.16, 0.18), i * 60);
        });
    }

    function sfxUltimate() {
        [220, 440, 660, 880, 1320].forEach((f, i) => {
            setTimeout(() => playTone(f, 'sawtooth', 0.2, 0.18, f * 1.25), i * 45);
        });
    }

    function sfxJump() { playTone(280, 'sine', 0.18, 0.15, 640); }
    function sfxDash() { playTone(180, 'sawtooth', 0.22, 0.18, 820); }
    function sfxSlide() { playTone(400, 'triangle', 0.14, 0.13, 150); }
    function sfxHit() { playTone(140, 'sawtooth', 0.32, 0.24, 50); }

    function playWinSound() {
        if (isMuted) return;
        unlockAudio();
        try {
            voiceLoseAudio.pause();
            voiceLoseAudio.currentTime = 0;
            voiceWinAudio.currentTime = 0;
            voiceWinAudio.volume = 1.0;
            voiceWinAudio.play().catch(() => {});
        } catch (e) {}
    }

    function playLoseSound() {
        if (isMuted) return;
        unlockAudio();
        try {
            voiceWinAudio.pause();
            voiceWinAudio.currentTime = 0;
            voiceLoseAudio.currentTime = 0;
            voiceLoseAudio.volume = 1.0;
            voiceLoseAudio.play().catch(() => {
                if ('speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                    const u = new SpeechSynthesisUtterance('حاول تاني يا أرنوبة يا دلوعة');
                    u.lang = 'ar-EG';
                    window.speechSynthesis.speak(u);
                }
            });
        } catch (e) {}
    }

    // ==================== 3. COMPLETE CATALOGS (CHARS, WORLDS, PETS, BOARDS, TRAILS, SHOP) ====================
    const BUNNY_CHARS = [
        {
            id: 'classic', name: 'الأرنوبة الشقية الكلاسيكية 🎀', badge: 'أساسي • مجاناً',
            desc: 'الأرنوبة الشقية الأصلية بفرو دافئ وفيونكة وردية دلوعة!',
            icon: '🐰🎀', cost: 0, currency: 'carrots',
            perkText: 'متوازنة وسريعة في القفز المزدوج',
            bonusCarrots: 0, extraLives: 0, autoShield: false, dashBonus: 0,
            previewBg: 'linear-gradient(135deg, #3b0764 0%, #be185d 100%)',
            furLight: '#f3f4f6', furMid: '#b48a64', furDark: '#78553a', stroke: '#452c1e',
            earOuter: '#9c6f4e', earInner: '#fb7185', bowColor: '#ec4899', tailColor: '#ffffff', footColor: '#e7e5e4',
            trailColor: '#38bdf8', accessory: 'bow'
        },
        {
            id: 'snow_princess', name: 'أرنوبة الثلج الملكية ❄️👑', badge: 'درع ثلجي 🛡️',
            desc: 'فرو أبيض ثلجي ناعم مع تاج الأميرة الذهبي وفيونكة الكريستال الجليدي!',
            icon: '❄️👑', cost: 400, currency: 'carrots',
            perkText: 'تبدأ كل جولة بدرع حماية تلقائي 🛡️',
            bonusCarrots: 0, extraLives: 0, autoShield: true, dashBonus: 0,
            previewBg: 'linear-gradient(135deg, #082f49 0%, #0284c7 60%, #bae6fd 100%)',
            furLight: '#ffffff', furMid: '#e0f2fe', furDark: '#7dd3fc', stroke: '#0369a1',
            earOuter: '#e0f2fe', earInner: '#38bdf8', bowColor: '#0ea5e9', tailColor: '#f0f9ff', footColor: '#ffffff',
            trailColor: '#7dd3fc', accessory: 'crown'
        },
        {
            id: 'ninja_bunny', name: 'الأرنب النينجا الخفي 🥷⚡', badge: 'نيترو سريع ⚡',
            desc: 'بدلة النينجا السوداء الخفية مع ربطة الرأس والوشاح الأحمر المتطاير!',
            icon: '🥷⚡', cost: 800, currency: 'carrots',
            perkText: 'يشحن النيترو أسرع 35% + (+1 🥕 لكل جزرة)',
            bonusCarrots: 1, extraLives: 0, autoShield: false, dashBonus: 45,
            previewBg: 'linear-gradient(135deg, #090d16 0%, #450a0a 60%, #dc2626 100%)',
            furLight: '#475569', furMid: '#1e293b', furDark: '#0f172a', stroke: '#ef4444',
            earOuter: '#1e293b', earInner: '#ef4444', bowColor: '#dc2626', tailColor: '#334155', footColor: '#1e293b',
            trailColor: '#ef4444', accessory: 'ninja'
        },
        {
            id: 'cyber_bunny', name: 'الأرنب الآلي السايبر 🤖💠', badge: 'مغناطيس + نيون 🧲',
            desc: 'جسم فضي مستقبلي مضيء بنبضات النيون السماوي ونظارة السايبر الذكية!',
            icon: '🤖💠', cost: 1500, currency: 'carrots',
            perkText: 'مغناطيس عند البدء + درع + (+1 🥕 لكل جزرة)',
            bonusCarrots: 1, extraLives: 0, autoShield: true, dashBonus: 35,
            previewBg: 'linear-gradient(135deg, #020617 0%, #1e1b4b 55%, #06b6d4 100%)',
            furLight: '#f8fafc', furMid: '#94a3b8', furDark: '#334155', stroke: '#06b6d4',
            earOuter: '#64748b', earInner: '#22d3ee', bowColor: '#06b6d4', tailColor: '#22d3ee', footColor: '#cbd5e1',
            trailColor: '#22d3ee', accessory: 'cyber'
        },
        {
            id: 'golden_king', name: 'الأرنب الذهبي الملكي 👑✨', badge: '+2 🥕 + قلب ❤️',
            desc: 'فرو ذهبي ملكي عيار 24 يلمع بالنجوم مع التاج الذهبي والرداء الملكي!',
            icon: '👑✨', cost: 2500, currency: 'carrots',
            perkText: '(+2 🥕 إضافية) + قلب صحة إضافي ❤️ + درع',
            bonusCarrots: 2, extraLives: 1, autoShield: true, dashBonus: 40,
            previewBg: 'linear-gradient(135deg, #422006 0%, #b45309 50%, #fde047 100%)',
            furLight: '#fef08a', furMid: '#eab308', furDark: '#a16207', stroke: '#713f12',
            earOuter: '#facc15', earInner: '#fef08a', bowColor: '#dc2626', tailColor: '#fef9c3', footColor: '#fde047',
            trailColor: '#fde047', accessory: 'king'
        },
        {
            id: 'cosmic_legend', name: 'أرنب المجرة الأسطوري 🌌🔥', badge: 'أجنحة كونية 🪽',
            desc: 'طاقة المجرة البنفسجية المتوهجة مع أجنحة نورانية وتاج الأسطورة!',
            icon: '🌌🪽', cost: 4000, currency: 'carrots',
            perkText: '(+3 🥕 إضافية) + قلبين ❤️❤️ + درع ونيترو خارق',
            bonusCarrots: 3, extraLives: 2, autoShield: true, dashBonus: 60,
            previewBg: 'linear-gradient(135deg, #090d16 0%, #581c87 45%, #ec4899 100%)',
            furLight: '#f5d0fe', furMid: '#a855f7', furDark: '#4c1d95', stroke: '#f472b6',
            earOuter: '#9333ea', earInner: '#38bdf8', bowColor: '#f43f5e', tailColor: '#e879f9', footColor: '#f0abfc',
            trailColor: '#e879f9', accessory: 'cosmic'
        },
        {
            id: 'phantom_shadow', name: 'الأرنب الشبح النيوني 👻⚡', badge: 'شخصية جواهر 💎',
            desc: 'كيان شبح نيون أخضر متوهج يطير بمرونة خيالية ويسرق الجزر عن بُعد!',
            icon: '👻💚', cost: 180, currency: 'gems',
            perkText: '(+3 🥕 إضافية) + قلبين ❤️❤️ + نيترو فائق السرعة!',
            bonusCarrots: 3, extraLives: 2, autoShield: true, dashBonus: 75,
            previewBg: 'linear-gradient(135deg, #022c22 0%, #059669 55%, #34d399 100%)',
            furLight: '#ecfdf5', furMid: '#10b981', furDark: '#064e3b', stroke: '#34d399',
            earOuter: '#047857', earInner: '#6ee7b7', bowColor: '#22d3ee', tailColor: '#a7f3d0', footColor: '#6ee7b7',
            trailColor: '#34d399', accessory: 'ninja'
        },
        {
            id: 'diamond_empress', name: 'إمبراطورة الألماس 💎👑', badge: 'أفشخ بطلة VIP ✨',
            desc: 'أندر شخصية في اللعبة! مصنوعة من الألماس السماوي النقي مع هالة ملكية خارقة!',
            icon: '💎👑', cost: 350, currency: 'gems',
            perkText: '(+5 🥕 إضافية لكل جزرة) + 3 قلوب ❤️❤️❤️ + درع + مغناطيس!',
            bonusCarrots: 5, extraLives: 3, autoShield: true, dashBonus: 85,
            previewBg: 'linear-gradient(135deg, #083344 0%, #0284c7 45%, #a855f7 100%)',
            furLight: '#ffffff', furMid: '#38bdf8', furDark: '#1d4ed8', stroke: '#67e8f9',
            earOuter: '#67e8f9', earInner: '#f0abfc', bowColor: '#38bdf8', tailColor: '#e0f2fe', footColor: '#bae6fd',
            trailColor: '#67e8f9', accessory: 'cosmic'
        }
    ];

    const WORLD_SKINS = [
        {
            id: 'auto', name: 'العالم التلقائي للمراحل', desc: 'يتغير شكل العالم تلقائياً حسب المرحلة (1-100).',
            icon: '🗺️', cost: 0, currency: 'carrots', bonusCarrotMult: 1,
            skyTop: '#061224', skyBottom: '#114b5f', hillColor1: '#064e3b', hillColor2: '#047857',
            groundColor: '#10b981', roadColor: '#3f2e21', weather: 'fireflies', sunColor: '#fde047',
            treeCrown: '#10b981', treeTrunk: '#3f2e21'
        },
        {
            id: 'candy_1000', name: 'عالم الحلوى والكاندي 🍭', desc: 'سماء وردية وأشجار غزل البنات وطريق الشوكولاتة! يمنحك ضعف الجزر (x2)!',
            icon: '🍭', cost: 1000, currency: 'carrots', bonusCarrotMult: 2,
            skyTop: '#4a044e', skyBottom: '#ec4899', hillColor1: '#831843', hillColor2: '#be185d',
            groundColor: '#f472b6', roadColor: '#451a03', weather: 'sakura', sunColor: '#fbcfe8',
            treeCrown: '#f43f5e', treeTrunk: '#fde047'
        },
        {
            id: 'cyber_2000', name: 'مدينة السايبر نيون 🤖', desc: 'عالم مستقبلي مضيء بألوان النيون السماوي والبنفسجي! مضاعف الجزر (x3)!',
            icon: '🌆', cost: 2000, currency: 'carrots', bonusCarrotMult: 3,
            skyTop: '#020617', skyBottom: '#3b0764', hillColor1: '#0f172a', hillColor2: '#1e1b4b',
            groundColor: '#06b6d4', roadColor: '#090d16', weather: 'stars', sunColor: '#22d3ee',
            treeCrown: '#a855f7', treeTrunk: '#06b6d4'
        },
        {
            id: 'pharaoh_3000', name: 'مملكة الكنوز والذهب 👑', desc: 'عالم ذهبي ملكي فخم بأشجار الزمرد! مضاعف الجزر (x4)!',
            icon: '👑', cost: 3000, currency: 'carrots', bonusCarrotMult: 4,
            skyTop: '#422006', skyBottom: '#eab308', hillColor1: '#713f12', hillColor2: '#a16207',
            groundColor: '#ffd700', roadColor: '#291502', weather: 'fireflies', sunColor: '#ffffff',
            treeCrown: '#f59e0b', treeTrunk: '#78350f'
        },
        {
            id: 'lava_4000', name: 'كوكب التنين والحمم 🐉', desc: 'عالم ناري خارق للأساطير مع شرارات بركانية! مضاعف الجزر (x5)!',
            icon: '🐉', cost: 4000, currency: 'carrots', bonusCarrotMult: 5,
            skyTop: '#180202', skyBottom: '#dc2626', hillColor1: '#450a0a', hillColor2: '#7f1d1d',
            groundColor: '#ff4500', roadColor: '#18181b', weather: 'embers', sunColor: '#f97316',
            treeCrown: '#ef4444', treeTrunk: '#27272a'
        },
        {
            id: 'galaxy_5000', name: 'المجرة الكونية اللانهائية 🌌', desc: 'فضاء كوني مرصع بالنجوم والشهب! مضاعف الجزر (x6)!',
            icon: '🌌', cost: 5000, currency: 'carrots', bonusCarrotMult: 6,
            skyTop: '#000000', skyBottom: '#1d4ed8', hillColor1: '#090d16', hillColor2: '#1e3a8a',
            groundColor: '#38bdf8', roadColor: '#020617', weather: 'stars', sunColor: '#e0f2fe',
            treeCrown: '#6366f1', treeTrunk: '#e2e8f0'
        },
        {
            id: 'atlantis_gems', name: 'مملكة أتلانتس البحرية 🔱', desc: 'أعماق المحيط المضيئة بالمرجان المتلألئ! مضاعف الجزر (x7)!',
            icon: '🔱', cost: 150, currency: 'gems', bonusCarrotMult: 7,
            skyTop: '#042f2e', skyBottom: '#0e7490', hillColor1: '#115e59', hillColor2: '#0f766e',
            groundColor: '#2dd4bf', roadColor: '#083344', weather: 'snow', sunColor: '#99f6e4',
            treeCrown: '#14b8a6', treeTrunk: '#0e7490'
        },
        {
            id: 'crystal_heaven', name: 'قلعة الألماس السماوية 💎', desc: 'أفخم عالم حصري للجواهر! قمم كريستالية مشعة ومضاعف جزر خارق (x8)!',
            icon: '💎', cost: 300, currency: 'gems', bonusCarrotMult: 8,
            skyTop: '#0f172a', skyBottom: '#6d28d9', hillColor1: '#312e81', hillColor2: '#4338ca',
            groundColor: '#67e8f9', roadColor: '#1e1b4b', weather: 'storm', sunColor: '#f0abfc',
            treeCrown: '#38bdf8', treeTrunk: '#c084fc'
        }
    ];

    const PETS_DATA = [
        { id: 'none', name: 'بدون حيوان أليف', icon: '➖', cost: 0, currency: 'carrots', desc: 'العب بدون رفيق مرافق.', perk: 'أساسي', color: '#94a3b8' },
        { id: 'baby_fox', name: 'الثعلب الصغير الذكي 🦊', icon: '🦊', cost: 800, currency: 'carrots', desc: 'رفيق لطيف يركض معك ويجذب الجزر القريبة تلقائياً!', perk: 'مغناطيس تلقائي خفيف +5 🥕 بداية كل مرحلة', color: '#fb923c' },
        { id: 'mini_dragon', name: 'التنين الناري الصغير 🐉', icon: '🐉', cost: 90, currency: 'gems', desc: 'تنين أسطوري يطير بجانبك ويطلق كرات نار تدمر العوائق أمامك!', perk: 'يطلق كرة نار تدمر عائق كل 7 ثواني 🔥', color: '#ef4444' },
        { id: 'cyber_owl', name: 'البومة السايبر الذكية 🦉', icon: '🦉', cost: 130, currency: 'gems', desc: 'بومة تقنية متطورة تسرّع شحن المهارة الخارقة بنسبة كبيرة!', perk: 'شحن المهارة الخارقة أسرع 40% 💥', color: '#22d3ee' },
        { id: 'star_fairy', name: 'جنية النجوم السحرية 🧚', icon: '🧚', cost: 180, currency: 'gems', desc: 'جنية مضيئة ترفع نسبة ظهور الجزر الذهبي وتمنح جزر إضافي!', perk: '+1 🥕 إضافية + فرصة جزر ذهبي مضاعفة ✨', color: '#e879f9' },
        { id: 'golden_griffin', name: 'العنقاء الملكية الذهبية 🦅', icon: '🦅', cost: 280, currency: 'gems', desc: 'أقوى رفيق في اللعبة! يضاعف الجزر ويهديك جواهر عند الفوز!', perk: '+2 🥕 إضافية + (+3 💎 هدية عند كل فوز!)', color: '#fbbf24' }
    ];

    const BOARDS_DATA = [
        { id: 'none', name: 'جري بالأقدام (بدون زلاجة)', icon: '👟', cost: 0, currency: 'carrots', desc: 'الجري الكلاسيكي السريع.', color: '#94a3b8', shieldCd: 0 },
        { id: 'neon_board', name: 'زلاجة النيون الطائرة 🛹', icon: '🛹', cost: 1200, currency: 'carrots', desc: 'زلاجة متوهجة تطفو فوق الأرض وتحميك من صدمة إضافية!', perk: 'حماية زلاجة تتجدد كل 18 ثانية ⚡', color: '#22d3ee', shieldCd: 1080 },
        { id: 'flame_jet', name: 'لوح اللهب النفاث 🔥', icon: '🔥', cost: 120, currency: 'gems', desc: 'زلاجة نارية تمنح قفزة أعلى +8% وحماية متكررة!', perk: 'قفزة أعلى + حماية تتجدد كل 14 ثانية', color: '#f97316', shieldCd: 840 },
        { id: 'galactic_surf', name: 'زلاجة المجرة الخارقة 🌌', icon: '🛸', cost: 240, currency: 'gems', desc: 'تكنولوجيا فضائية خارقة تحميك كل 10 ثوانٍ وتزيد الجزر!', perk: '+1 🥕 + حماية تتجدد كل 10 ثواني 👑', color: '#c084fc', shieldCd: 600 }
    ];

    const TRAILS_DATA = [
        { id: 'default', name: 'توهج كلاسيكي ✨', icon: '✨', cost: 0, currency: 'carrots', desc: 'آثار حركة بسيطة ونظيفة.', colors: ['#38bdf8'] },
        { id: 'rainbow', name: 'طيف قوس قزح 🌈', icon: '🌈', cost: 600, currency: 'carrots', desc: 'ألوان قوس قزح المبهجة تتبعك في كل قفزة!', colors: ['#f43f5e', '#fb923c', '#fde047', '#22c55e', '#38bdf8', '#a855f7'] },
        { id: 'fire', name: 'لهيب التنين الحارق 🔥', icon: '🔥', cost: 70, currency: 'gems', desc: 'شرارات نار متطايرة خلف الأرنوبة!', colors: ['#ef4444', '#f97316', '#fde047'] },
        { id: 'galaxy', name: 'سديم المجرة 🌌', icon: '🌌', cost: 110, currency: 'gems', desc: 'غبار نجوم بنفسجي وأزرق متلألئ.', colors: ['#c084fc', '#818cf8', '#38bdf8'] },
        { id: 'hearts', name: 'قلوب الدلع 💖', icon: '💖', cost: 850, currency: 'carrots', desc: 'قلوب وردية تتطاير خلف الأرنوبة الشقية!', colors: ['#f43f5e', '#fb7185', '#f472b6'] },
        { id: 'lightning', name: 'صاعقة البرق ⚡', icon: '⚡', cost: 150, currency: 'gems', desc: 'ومضات كهربائية صفراء وسماوية خاطفة!', colors: ['#fde047', '#22d3ee', '#ffffff'] }
    ];

    const ULTIMATES_DATA = [
        { id: 'nova', name: 'موجة الانفجار الكوني 💥', icon: '💥', cost: 0, currency: 'gems', desc: 'تدمر جميع العوائق في الشاشة فوراً وتمنحك +20 جزرة + نيترو!', color: '#f43f5e' },
        { id: 'time_warp', name: 'إبطاء الزمن والمغناطيس ⏳', icon: '⏳', cost: 80, currency: 'gems', desc: 'تبطئ العقبات وتمنحك درعاً ومغناطيساً عملاقاً لمدة 6 ثوانٍ!', color: '#22d3ee' },
        { id: 'gold_rush', name: 'عاصفة الجزر الذهبي 🥕✨', icon: '🥕', cost: 120, currency: 'gems', desc: 'تمطر السماء 18 جزرة ذهبية فورية وتفعل الحماية الكاملة!', color: '#fbbf24' }
    ];

    const TOPUP_PACKAGES = [
        { id: 'gems_100', name: 'حزمة البداية السريعة', gems: 100, bonusCarrots: 500, price: '25 ج.م', icon: '💎', vip: false, hot: '' },
        { id: 'gems_600', name: 'حزمة الأبطال الذهبية', gems: 600, bonusCarrots: 2500, price: '99 ج.م', icon: '💠', vip: false, hot: 'الأكثر طلباً 🔥' },
        { id: 'gems_1900', name: 'باقة الملوك + VIP', gems: 1900, bonusCarrots: 8000, price: '249 ج.م', icon: '👑', vip: true, hot: 'تفتح VIP 👑' },
        { id: 'gems_6500', name: 'خزنة الأساطير الكونية', gems: 6500, bonusCarrots: 30000, price: '699 ج.م', icon: '🌌', vip: true, hot: 'أكبر توفير ⚡' }
    ];

    const CHESTS_DATA = [
        { id: 'bronze_chest', name: 'صندوق الجزر البرونزي 📦', cost: 500, currency: 'carrots', icon: '📦', desc: 'اربح 300-1100 🥕 أو 10-35 💎 + نقاط خبرة XP!' },
        { id: 'gold_chest', name: 'صندوق الأبطال الذهبي 🧰', cost: 50, currency: 'gems', icon: '🧰', desc: 'اربح 1500-3500 🥕 أو رفيق/زلاجة/أثر جديد أو 70-140 💎!' },
        { id: 'diamond_chest', name: 'صندوق الألماس الأسطوري 👑', cost: 150, currency: 'gems', icon: '🎁', desc: 'فرصة ضخمة لفتح شخصية نادرة أو رفيق أو عالم جواهر أو 240-450 💎!' }
    ];

    const EXCHANGE_PACKS = [
        { id: 'ex_1', gemsCost: 15, carrotsGain: 600, label: 'تحويل سريع' },
        { id: 'ex_2', gemsCost: 50, carrotsGain: 2500, label: 'عرض الضعف 🔥' },
        { id: 'ex_3', gemsCost: 120, carrotsGain: 7500, label: 'خزنة جزر ضخمة 💰' }
    ];

    const DAILY_REWARDS = [
        { day: 1, carrots: 200, gems: 10, icon: '🥕' },
        { day: 2, carrots: 400, gems: 15, icon: '💎' },
        { day: 3, carrots: 600, gems: 25, icon: '⚡' },
        { day: 4, carrots: 900, gems: 35, icon: '🛡️' },
        { day: 5, carrots: 1200, gems: 50, icon: '🎁' },
        { day: 6, carrots: 1800, gems: 75, icon: '👑' },
        { day: 7, carrots: 3500, gems: 150, icon: '🌌' }
    ];

    const SPIN_PRIZES = [
        { label: '150 🥕', type: 'carrots', amount: 150, color: '#f97316' },
        { label: '20 💎', type: 'gems', amount: 20, color: '#06b6d4' },
        { label: '400 🥕', type: 'carrots', amount: 400, color: '#eab308' },
        { label: '50 💎', type: 'gems', amount: 50, color: '#7c3aed' },
        { label: '1000 🥕', type: 'carrots', amount: 1000, color: '#10b981' },
        { label: '100 💎', type: 'gems', amount: 100, color: '#ec4899' },
        { label: '250 XP', type: 'xp', amount: 250, color: '#3b82f6' },
        { label: '250 💎🔥', type: 'gems', amount: 250, color: '#dc2626' }
    ];

    const BP_TIERS = Array.from({ length: 10 }, (_, idx) => {
        const tier = idx + 1;
        return {
            tier,
            xpNeed: tier * 200,
            free: tier % 2 === 0
                ? { type: 'gems', amount: 15 + tier * 5, label: `${15 + tier * 5} 💎` }
                : { type: 'carrots', amount: 300 * tier, label: `${300 * tier} 🥕` },
            vip: tier === 10
                ? { type: 'gems', amount: 400, label: '400 💎 + تاج VIP' }
                : { type: 'gems', amount: 35 + tier * 15, label: `${35 + tier * 15} 💎` }
        };
    });

    const DAILY_QUESTS_DEF = [
        { id: 'q_carrots', key: 'carrots', title: 'جامع الجزر المحترف', desc: 'اجمع 80 جزرة في أي طور لعب', target: 80, carrots: 300, gems: 15, xp: 100 },
        { id: 'q_races', key: 'races', title: 'بطل السباقات الأونلاين', desc: 'شارك في سباقين أونلاين', target: 2, carrots: 500, gems: 25, xp: 150 },
        { id: 'q_dashes', key: 'dashes', title: 'سرعة البرق النيترو', desc: 'استخدم اندفاع النيترو 8 مرات', target: 8, carrots: 250, gems: 15, xp: 90 },
        { id: 'q_levels', key: 'levels', title: 'قاهر المراحل', desc: 'أكمل مرحلتين بنجاح', target: 2, carrots: 450, gems: 20, xp: 120 }
    ];

    const ACHIEVEMENTS_DEF = [
        { id: 'ach_lvl10', title: 'العبور الأول 🌟', desc: 'افتح المرحلة 10', check: p => p.unlockedLevel >= 10, gems: 40, carrots: 500 },
        { id: 'ach_lvl50', title: 'محارب المراحل 🔥', desc: 'افتح المرحلة 50', gems: 150, carrots: 2000, check: p => p.unlockedLevel >= 50 },
        { id: 'ach_stars50', title: 'صياد النجوم ⭐', desc: 'احصل على 50 نجمة إجمالاً', gems: 60, carrots: 800, check: p => Object.values(p.levelStars).reduce((a, b) => a + b, 0) >= 50 },
        { id: 'ach_race5', title: 'بطل المضمار 🏎️', desc: 'فُز بـ 5 سباقات أونلاين (مركز أول)', gems: 80, carrots: 1000, check: p => p.racesWon >= 5 },
        { id: 'ach_endless3k', title: 'نفس طويل ♾️', desc: 'اقطع 3000 متر في الطور اللانهائي', gems: 100, carrots: 1500, check: p => p.endlessHighScore >= 3000 },
        { id: 'ach_rich5k', title: 'مليونير الجزر 🥕', desc: 'اجمع 5000 جزرة إجمالاً', gems: 50, carrots: 1000, check: p => p.totalCarrots >= 5000 }
    ];

    const TITLES_LIST = [
        'أرنوب مغامر',
        'صياد الجزر 🥕',
        'ملك السباقات 🏎️',
        'قاهر الزعماء 🐉',
        'أسطورة المجرة 🌌',
        'كبار الشخصيات VIP 👑'
    ];

    const LOCAL_PROMO_CODES = {
        ARNOUBA2026: { gems: 250, carrots: 2000, label: '250 جوهرة + 2000 جزرة' },
        VIPGEMS: { gems: 500, carrots: 1000, label: '500 جوهرة + 1000 جزرة' },
        MEGA1000: { gems: 1000, carrots: 5000, label: '1000 جوهرة + 5000 جزرة' },
        FREE500: { gems: 100, carrots: 500, label: '100 جوهرة + 500 جزرة' },
        SPEEDKING: { gems: 300, carrots: 1500, label: '300 جوهرة + 1500 جزرة' }
    };

    const BIOMES = [
        { icon: '🌿', title: 'غابة الزمرد', skyTop: '#061224', skyBottom: '#114b5f', hillColor1: '#064e3b', hillColor2: '#047857', groundColor: '#10b981', roadColor: '#3f2e21', weather: 'fireflies', obstacles: ['rock', 'log', 'smart_drone'] },
        { icon: '💎', title: 'وادي الكريستال', skyTop: '#1e1b4b', skyBottom: '#6d28d9', hillColor1: '#311042', hillColor2: '#4c1d95', groundColor: '#8b5cf6', roadColor: '#1e1b4b', weather: 'snow', obstacles: ['crystal_spike', 'log', 'smart_drone', 'laser_gate'] },
        { icon: '🏜️', title: 'صحراء الفخاخ', skyTop: '#451a03', skyBottom: '#d97706', hillColor1: '#78350f', hillColor2: '#b45309', groundColor: '#f59e0b', roadColor: '#451a03', weather: 'sand', obstacles: ['cactus', 'ninja_fox', 'spike_roller', 'smart_drone'] },
        { icon: '🌋', title: 'قلعة الحمم', skyTop: '#2a0404', skyBottom: '#dc2626', hillColor1: '#450a0a', hillColor2: '#7f1d1d', groundColor: '#ef4444', roadColor: '#18181b', weather: 'embers', obstacles: ['fire', 'laser_gate', 'spike_roller', 'ninja_fox'] },
        { icon: '❄️', title: 'القمة الجليدية', skyTop: '#082f49', skyBottom: '#0284c7', hillColor1: '#0c4a6e', hillColor2: '#0369a1', groundColor: '#38bdf8', roadColor: '#0f172a', weather: 'snow', obstacles: ['crystal_spike', 'spike_roller', 'smart_drone', 'laser_gate'] },
        { icon: '🎃', title: 'المستنقع المسحور', skyTop: '#140b29', skyBottom: '#4c1d95', hillColor1: '#2e1065', hillColor2: '#581c87', groundColor: '#a855f7', roadColor: '#1e1b4b', weather: 'storm', obstacles: ['log', 'fire', 'ninja_fox', 'smart_drone', 'laser_gate'] },
        { icon: '⚡', title: 'مصنع الروبوتات', skyTop: '#090d16', skyBottom: '#334155', hillColor1: '#1e293b', hillColor2: '#475569', groundColor: '#64748b', roadColor: '#0f172a', weather: 'stars', obstacles: ['spike_roller', 'smart_drone', 'laser_gate', 'fire'] },
        { icon: '🌸', title: 'عالم الساكورا', skyTop: '#3b0764', skyBottom: '#db2777', hillColor1: '#500724', hillColor2: '#831843', groundColor: '#f43f5e', roadColor: '#271224', weather: 'sakura', obstacles: ['crystal_spike', 'ninja_fox', 'spike_roller', 'smart_drone', 'laser_gate'] },
        { icon: '☄️', title: 'كوكب النيازك', skyTop: '#180404', skyBottom: '#9a3412', hillColor1: '#431407', hillColor2: '#7c2d12', groundColor: '#ea580c', roadColor: '#1c1917', weather: 'embers', obstacles: ['rock', 'fire', 'spike_roller', 'ninja_fox', 'laser_gate', 'smart_drone'] },
        { icon: '🌌', title: 'المجرة الأسطورية', skyTop: '#020617', skyBottom: '#0e7490', hillColor1: '#0f172a', hillColor2: '#155e75', groundColor: '#06b6d4', roadColor: '#090d16', weather: 'stars', obstacles: ['crystal_spike', 'cactus', 'fire', 'spike_roller', 'ninja_fox', 'smart_drone', 'laser_gate'] }
    ];

    const TOTAL_LEVELS = 100;
    const LEVELS = [];
    for (let i = 1; i <= TOTAL_LEVELS; i++) {
        const wIdx = Math.floor((i - 1) / 10);
        const b = BIOMES[wIdx];
        const speed = Number((6.2 + (i - 1) * 0.1).toFixed(2));
        const obstacleInterval = Math.max(42, Math.round(114 - (i - 1) * 0.7));
        const targetCarrots = 15 + Math.floor((i - 1) / 2) * 5;
        const levelLength = 4200 + (i - 1) * 230;
        LEVELS.push({
            id: i, worldIndex: wIdx,
            name: `${b.title} - مرحلة ${i}`, icon: b.icon,
            isBossStage: i % 10 === 0,
            targetCarrots, levelLength, speed, obstacleInterval,
            skyTop: b.skyTop, skyBottom: b.skyBottom, hillColor1: b.hillColor1, hillColor2: b.hillColor2,
            groundColor: b.groundColor, roadColor: b.roadColor, weather: b.weather, obstacles: b.obstacles
        });
    }

    // ==================== LEVEL DEVIL 200-STAGE DATA ====================
    const TOTAL_DEVIL_LEVELS = 200;
    const DEVIL_CHAPTERS = [
        { title: 'بوابة الشيطان', icon: '😈', skyTop: '#1f0612', skyBottom: '#7f1d1d', hillColor1: '#450a0a', hillColor2: '#2e0814', groundColor: '#dc2626', roadColor: '#170a10', weather: 'embers', hint: 'حفر وأشواك مخفية' },
        { title: 'أرض الفخاخ', icon: '🕳️', skyTop: '#180524', skyBottom: '#6b21a8', hillColor1: '#3b0764', hillColor2: '#23043d', groundColor: '#a855f7', roadColor: '#12081c', weather: 'none', hint: 'أرضيات بتهبط فجأة' },
        { title: 'حفر الغدر', icon: '⚠️', skyTop: '#240404', skyBottom: '#991b1b', hillColor1: '#520a0a', hillColor2: '#330606', groundColor: '#ef4444', roadColor: '#1c0909', weather: 'ash', hint: 'أعمدة ساقطة + فخاخ' },
        { title: 'شفرات الجحيم', icon: '🪚', skyTop: '#0f0720', skyBottom: '#831843', hillColor1: '#500724', hillColor2: '#2b0514', groundColor: '#ec4899', roadColor: '#160711', weather: 'embers', hint: 'مناشير متحركة' },
        { title: 'الجزر الملعون', icon: '🥕', skyTop: '#1f1006', skyBottom: '#9a3412', hillColor1: '#431407', hillColor2: '#270b04', groundColor: '#f97316', roadColor: '#170d06', weather: 'none', hint: 'مقالب الجزر السحري' },
        { title: 'العاصفة الدموية', icon: '⛈️', skyTop: '#09090b', skyBottom: '#7f1d1d', hillColor1: '#27272a', hillColor2: '#18181b', groundColor: '#f43f5e', roadColor: '#111114', weather: 'storm', hint: 'باب نهاية هارب!' },
        { title: 'متاهة النينجا', icon: '🦊', skyTop: '#061522', skyBottom: '#7c2d12', hillColor1: '#1e293b', hillColor2: '#0f172a', groundColor: '#fb7185', roadColor: '#0f1018', weather: 'snow', hint: 'سرعة عالية + ثعالب' },
        { title: 'برج الجاذبية', icon: '🗿', skyTop: '#13072e', skyBottom: '#4c1d95', hillColor1: '#2e1065', hillColor2: '#170736', groundColor: '#c084fc', roadColor: '#0e071c', weather: 'stars', hint: 'أعمدة سريعة + مناشير' },
        { title: 'عرش المقالب', icon: '👑', skyTop: '#1e040b', skyBottom: '#9f1239', hillColor1: '#4c0519', hillColor2: '#2c030e', groundColor: '#fda4af', roadColor: '#17040a', weather: 'embers', hint: 'كل المقالب مجتمعة' },
        { title: 'جحيم الأرنب الأسطوري', icon: '🔥', skyTop: '#050105', skyBottom: '#b91c1c', hillColor1: '#450a0a', hillColor2: '#1a0305', groundColor: '#fbbf24', roadColor: '#140404', weather: 'embers', hint: 'اختبار الأساطير النهائي' }
    ];

    const DEVIL_LEVELS = [];
    for (let i = 1; i <= TOTAL_DEVIL_LEVELS; i++) {
        const cIdx = Math.min(9, Math.floor((i - 1) / 20));
        const ch = DEVIL_CHAPTERS[cIdx];
        const stageInChap = ((i - 1) % 20) + 1;
        const speed = Math.min(11.4, Number((6.6 + i * 0.022 + (stageInChap % 5) * 0.1).toFixed(2)));
        const levelLength = Math.min(9200, 3200 + i * 28);
        const targetCarrots = Math.min(48, 12 + Math.floor(i * 0.16));
        const hasRunawayDoor = i >= 15 && (i % 3 === 0 || i >= 120);
        DEVIL_LEVELS.push({
            id: i,
            chapterIndex: cIdx,
            name: `${ch.title} — المقلب ${i}`,
            icon: ch.icon,
            isBossStage: false,
            isDevilStage: true,
            hasRunawayDoor,
            targetCarrots,
            levelLength,
            speed,
            obstacleInterval: Math.max(46, Math.round(74 - i * 0.13)),
            skyTop: ch.skyTop,
            skyBottom: ch.skyBottom,
            hillColor1: ch.hillColor1,
            hillColor2: ch.hillColor2,
            groundColor: ch.groundColor,
            roadColor: ch.roadColor,
            weather: ch.weather,
            obstacles: ['rock', 'spike_roller', 'smart_drone']
        });
    }

    const UPGRADE_ITEMS = [
        { key: 'maxLives', title: 'قلوب إضافية للأرنوبة ❤️', desc: 'تبدأ كل مرحلة بقلب صحة إضافي لتحمل الصدمات.', icon: '💖', maxLevel: 3, costs: [50, 150, 300] },
        { key: 'magnetDuration', title: 'مغناطيس الجزر الذكي 🧲', desc: 'يجذب الجزر البعيد والطائر تلقائياً لفترة أطول.', icon: '🧲', maxLevel: 3, costs: [40, 120, 250] },
        { key: 'dashPower', title: 'تيربو النيترو الخارق ⚡', desc: 'يقلل وقت انتظار الاندفاع الخارق (Dash) اللي بيحطم العوائق!', icon: '⚡', maxLevel: 3, costs: [50, 140, 280] },
        { key: 'doubleCarrot', title: 'الجزر الذهبي المضاعف ✨', desc: 'يزيد فرصة ظهور الجزر الذهبي (بـ 5 جزرات) لتجميع الجزر بسرعة!', icon: '🥕', maxLevel: 3, costs: [60, 180, 350] }
    ];

    const PLAY_STYLES_DATA = [
        {
            id: 'runner', icon: '🏃‍♀️', shortName: 'جري', name: 'الجري والقفز الكلاسيكي',
            touchJumpIco: '⬆️', touchJumpTxt: 'قفز', touchSlideIco: '⬇️', touchSlideTxt: 'انزلاق', touchDashIco: '⚡', touchDashTxt: 'نيترو',
            hintTouch: '<span>⬆️ قفز ودبل جامب</span><span>⬇️ انزلاق</span><span>⚡ نيترو</span><span>💥 خارق</span>',
            hintKey: '<span><kbd>Space</kbd>/<kbd>⬆️</kbd> قفز</span><span><kbd>⬇️</kbd> انزلاق</span><span><kbd>Alt</kbd> نيترو</span><span><kbd>E</kbd> خارق 💥</span><span><kbd>G</kbd> تبديل الطريقة</span>'
        },
        {
            id: 'jetpack', icon: '🚀', shortName: 'طيران', name: 'الطيران النفاث والليزر',
            touchJumpIco: '🚀', touchJumpTxt: 'طيران فوق', touchSlideIco: '🔽', touchSlideTxt: 'غوص تحت', touchDashIco: '🔫', touchDashTxt: 'ليزر ثلاثي',
            hintTouch: '<span>🚀 اضغط/استمر للطيران فوق</span><span>🔽 غوص سريع</span><span>🔫 ليزر ثلاثي</span><span>💥 خارق</span>',
            hintKey: '<span><kbd>Space</kbd>/<kbd>⬆️</kbd> طيران</span><span><kbd>⬇️</kbd> غوص</span><span><kbd>Alt</kbd>/<kbd>Z</kbd> ليزر 🔫</span><span><kbd>E</kbd> خارق</span><span><kbd>G</kbd> تبديل الطريقة</span>'
        },
        {
            id: 'lanes', icon: '🛹', shortName: '3 مسارات', name: 'تزلج الـ 3 مسارات',
            touchJumpIco: '⬆️', touchJumpTxt: 'حارة فوق', touchSlideIco: '⬇️', touchSlideTxt: 'حارة تحت', touchDashIco: '🦘', touchDashTxt: 'قفز/نيترو',
            hintTouch: '<span>⬆️ حارة فوق</span><span>⬇️ حارة تحت</span><span>🦘 قفز بالمسار</span><span>💥 خارق</span>',
            hintKey: '<span><kbd>⬆️</kbd> حارة فوق</span><span><kbd>⬇️</kbd> حارة تحت</span><span><kbd>Space</kbd>/<kbd>Alt</kbd> قفز بالمسار</span><span><kbd>E</kbd> خارق</span><span><kbd>G</kbd> تبديل</span>'
        }
    ];

    const INTRO_SLIDES = [
        { badge: 'الإصدار الأونلاين 1 / 3', title: 'أهلاً بيك في الأرنوبة الشقية v10 🐰💎', text: 'سباقات أونلاين حية ضد لاعبين، 100 مرحلة، طور لانهائي، ومعارك زعماء ملحمية!' },
        { badge: 'الجواهر والرفاق 2 / 3', title: 'اجمع الجواهر وافتح الرفاق والزلاجات! 💎🐾', text: 'اشحن جواهر أو افتح صناديق الحظ لتكسب تنين يضرب العوائق، زلاجات طائرة، ومهارات خارقة!' },
        { badge: 'التحكم الذكي 3 / 3', title: 'قفز مزدوج، انزلاق، نيترو، ومهارة خارقة ⚡💥', text: 'اقفز فوق الفخاخ، انزلق تحت الدرونز، شغّل النيترو، وأطلق الموجة الخارقة لما تشحن 100%!' }
    ];

    // ==================== 4. ACCOUNT & CLOUD/LOCAL STORAGE SYSTEM ====================
    const LOCAL_USERS_KEY = 'arnouba_local_accounts_v6';
    const LOCAL_CLANS_KEY = 'arnouba_local_clans_v10';
    const SESSION_KEY = 'arnouba_session_v6';

    let serverOnline = false;
    let currentUser = null;

    function todayStr() {
        return new Date().toISOString().slice(0, 10);
    }

    function defaultProgress() {
        return {
            seenIntro: false,
            bankCarrots: 0,
            totalCarrots: 0,
            gems: 50,
            trophies: 0,
            xp: 0,
            endlessHighScore: 0,
            racesPlayed: 0,
            racesWon: 0,
            unlockedLevel: 1,
            levelStars: {},
            devilUnlockedLevel: 1,
            devilStars: {},
            devilDeaths: 0,
            ownedWorlds: ['auto'],
            equippedWorld: 'auto',
            ownedChars: ['classic'],
            equippedChar: 'classic',
            ownedPets: ['none'],
            equippedPet: 'none',
            ownedBoards: ['none'],
            equippedBoard: 'none',
            ownedTrails: ['default'],
            equippedTrail: 'default',
            equippedUltimate: 'nova',
            playStyle: 'runner',
            title: 'أرنوب مغامر',
            clanId: '',
            vipPass: false,
            bpClaimed: [],
            loginStreak: 0,
            lastLoginDate: '',
            lastSpinTime: 0,
            quests: { date: todayStr(), carrots: 0, races: 0, dashes: 0, levels: 0, claimed: [] },
            achievements: [],
            redeemedCodes: [],
            topupHistory: [],
            upgrades: { maxLives: 0, magnetDuration: 0, dashPower: 0, doubleCarrot: 0 }
        };
    }

    function normalizeProgress(p) {
        const d = defaultProgress();
        if (!p || typeof p !== 'object') return d;
        d.seenIntro = Boolean(p.seenIntro);
        d.bankCarrots = Math.max(0, parseInt(p.bankCarrots || 0, 10) || 0);
        d.totalCarrots = Math.max(d.bankCarrots, parseInt(p.totalCarrots || 0, 10) || 0);
        d.gems = (p.gems !== undefined && p.gems !== null) ? Math.max(0, parseInt(p.gems, 10) || 0) : 50;
        d.trophies = Math.max(0, parseInt(p.trophies || 0, 10) || 0);
        d.xp = Math.max(0, parseInt(p.xp || 0, 10) || 0);
        d.endlessHighScore = Math.max(0, parseInt(p.endlessHighScore || 0, 10) || 0);
        d.racesPlayed = Math.max(0, parseInt(p.racesPlayed || 0, 10) || 0);
        d.racesWon = Math.max(0, parseInt(p.racesWon || 0, 10) || 0);
        d.unlockedLevel = Math.max(1, Math.min(TOTAL_LEVELS, parseInt(p.unlockedLevel || 1, 10) || 1));
        d.devilUnlockedLevel = Math.max(1, Math.min(TOTAL_DEVIL_LEVELS, parseInt(p.devilUnlockedLevel || 1, 10) || 1));
        d.devilDeaths = Math.max(0, parseInt(p.devilDeaths || 0, 10) || 0);

        if (p.levelStars && typeof p.levelStars === 'object') {
            Object.keys(p.levelStars).forEach(k => {
                const lvl = parseInt(k, 10);
                if (lvl >= 1 && lvl <= TOTAL_LEVELS) {
                    d.levelStars[lvl] = Math.max(0, Math.min(3, parseInt(p.levelStars[k], 10) || 0));
                }
            });
        }
        if (p.devilStars && typeof p.devilStars === 'object') {
            Object.keys(p.devilStars).forEach(k => {
                const dlvl = parseInt(k, 10);
                if (dlvl >= 1 && dlvl <= TOTAL_DEVIL_LEVELS) {
                    d.devilStars[dlvl] = Math.max(0, Math.min(3, parseInt(p.devilStars[k], 10) || 0));
                }
            });
        }
        const mergeList = (src, dest) => {
            if (Array.isArray(src)) src.forEach(x => { if (typeof x === 'string' && !dest.includes(x)) dest.push(x); });
        };
        mergeList(p.ownedWorlds, d.ownedWorlds);
        d.equippedWorld = d.ownedWorlds.includes(p.equippedWorld) ? p.equippedWorld : 'auto';
        mergeList(p.ownedChars, d.ownedChars);
        d.equippedChar = d.ownedChars.includes(p.equippedChar) ? p.equippedChar : 'classic';
        mergeList(p.ownedPets, d.ownedPets);
        d.equippedPet = d.ownedPets.includes(p.equippedPet) ? p.equippedPet : 'none';
        mergeList(p.ownedBoards, d.ownedBoards);
        d.equippedBoard = d.ownedBoards.includes(p.equippedBoard) ? p.equippedBoard : 'none';
        mergeList(p.ownedTrails, d.ownedTrails);
        d.equippedTrail = d.ownedTrails.includes(p.equippedTrail) ? p.equippedTrail : 'default';

        d.equippedUltimate = ULTIMATES_DATA.some(u => u.id === p.equippedUltimate) ? p.equippedUltimate : 'nova';
        d.playStyle = PLAY_STYLES_DATA.some(s => s.id === p.playStyle) ? p.playStyle : 'runner';
        d.title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : 'أرنوب مغامر';
        d.clanId = typeof p.clanId === 'string' ? p.clanId : '';
        d.vipPass = Boolean(p.vipPass);
        d.bpClaimed = Array.isArray(p.bpClaimed) ? p.bpClaimed : [];
        d.loginStreak = Math.max(0, parseInt(p.loginStreak || 0, 10) || 0);
        d.lastLoginDate = typeof p.lastLoginDate === 'string' ? p.lastLoginDate : '';
        d.lastSpinTime = Math.max(0, parseInt(p.lastSpinTime || 0, 10) || 0);
        d.achievements = Array.isArray(p.achievements) ? p.achievements : [];
        d.redeemedCodes = Array.isArray(p.redeemedCodes) ? p.redeemedCodes : [];
        d.topupHistory = Array.isArray(p.topupHistory) ? p.topupHistory : [];

        if (p.quests && typeof p.quests === 'object' && p.quests.date === todayStr()) {
            d.quests = {
                date: todayStr(),
                carrots: parseInt(p.quests.carrots || 0, 10) || 0,
                races: parseInt(p.quests.races || 0, 10) || 0,
                dashes: parseInt(p.quests.dashes || 0, 10) || 0,
                levels: parseInt(p.quests.levels || 0, 10) || 0,
                claimed: Array.isArray(p.quests.claimed) ? p.quests.claimed : []
            };
        }

        if (p.upgrades && typeof p.upgrades === 'object') {
            ['maxLives', 'magnetDuration', 'dashPower', 'doubleCarrot'].forEach(k => {
                d.upgrades[k] = Math.max(0, Math.min(3, parseInt(p.upgrades[k] || 0, 10) || 0));
            });
        }
        return d;
    }

    function ensureTodayQuests() {
        if (!currentUser) return;
        const p = currentUser.progress;
        const t = todayStr();
        if (!p.quests || p.quests.date !== t) {
            p.quests = { date: t, carrots: 0, races: 0, dashes: 0, levels: 0, claimed: [] };
        }
    }

    function trackQuest(key, amount = 1) {
        if (!currentUser) return;
        ensureTodayQuests();
        currentUser.progress.quests[key] = (currentUser.progress.quests[key] || 0) + amount;
    }

    function getLocalAccounts() {
        try { return JSON.parse(localStorage.getItem(LOCAL_USERS_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function saveLocalAccounts(db) {
        try { localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(db)); } catch (e) {}
    }
    function getLocalClans() {
        try { return JSON.parse(localStorage.getItem(LOCAL_CLANS_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function saveLocalClans(db) {
        try { localStorage.setItem(LOCAL_CLANS_KEY, JSON.stringify(db)); } catch (e) {}
    }

    const API_ENDPOINT = (window.location && window.location.protocol === 'file:')
        ? 'https://rabit.megadeveloper.site/api.php'
        : 'api.php';

    async function apiCall(action, payload = null) {
        const opts = {
            method: payload ? 'POST' : 'GET',
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
        };
        if (payload) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(payload);
        }
        const res = await fetch(`${API_ENDPOINT}?action=${encodeURIComponent(action)}`, opts);
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch (e) { throw new Error('PHP_NOT_ACTIVE'); }
        if (!data || typeof data.ok !== 'boolean') throw new Error('PHP_NOT_ACTIVE');
        return data;
    }

    async function checkServerAvailable() {
        try {
            const res = await apiCall('ping');
            serverOnline = Boolean(res && res.ok);
        } catch (e) {
            serverOnline = false;
        }
        const modeEl = document.getElementById('auth-mode');
        if (modeEl) {
            modeEl.textContent = serverOnline
                ? '☁️ متصل بالسيرفر السحابي (حسابك والسباقات الأونلاين شغالة على كل الأجهزة)'
                : '💾 وضع التشغيل المحلي (السيرفر يرتبط تلقائياً عند الرفع على الاستضافة)';
        }
    }

    function saveSession() {
        if (!currentUser) {
            localStorage.removeItem(SESSION_KEY);
            return;
        }
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify({
                username: currentUser.username,
                token: currentUser.token || '',
                progress: currentUser.progress
            }));
            const db = getLocalAccounts();
            const key = currentUser.username.toLowerCase();
            if (db[key]) {
                db[key].progress = currentUser.progress;
                saveLocalAccounts(db);
            }
        } catch (e) {}
    }

    let syncTimer = null;
    function syncProgress() {
        if (!currentUser) return;
        saveSession();
        if (serverOnline && currentUser.token) {
            if (syncTimer) clearTimeout(syncTimer);
            syncTimer = setTimeout(() => {
                apiCall('save', { token: currentUser.token, progress: currentUser.progress }).catch(() => {});
            }, 250);
        }
    }

    // ==================== 5. UI SCREENS, MODALS & NAVIGATION ====================
    const screens = {
        boot: document.getElementById('boot-screen'),
        auth: document.getElementById('auth-screen'),
        intro: document.getElementById('intro-screen'),
        home: document.getElementById('home-screen'),
        pause: document.getElementById('pause-screen'),
        result: document.getElementById('result-screen'),
        revive: document.getElementById('revive-modal'),
        topup: document.getElementById('topup-modal'),
        spin: document.getElementById('spin-modal'),
        daily: document.getElementById('daily-modal'),
        pass: document.getElementById('pass-modal'),
        promo: document.getElementById('promo-modal'),
        profile: document.getElementById('profile-modal')
    };
    const hudEl = document.getElementById('hud');
    const touchControlsEl = document.getElementById('touch-controls');
    const rotateOverlayEl = document.getElementById('rotate-overlay');
    const toastEl = document.getElementById('toast');

    let toastTimeout = null;
    function showToast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.classList.remove('hidden');
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => toastEl.classList.add('hidden'), 3000);
    }

    function showOnlyScreen(name) {
        Object.keys(screens).forEach(k => {
            if (screens[k]) screens[k].classList.toggle('hidden', k !== name);
        });
        const playing = name === null;
        hudEl.classList.toggle('hidden', !playing);
        touchControlsEl.classList.toggle('hidden', !(playing && isTouchDevice));
    }

    function toggleOverlayModal(name, show) {
        if (screens[name]) screens[name].classList.toggle('hidden', !show);
    }

    // ==================== 6. RESPONSIVE PORTRAIT + LANDSCAPE VIEWPORT ====================
    let V_HEIGHT = 720;
    let V_WIDTH = 1280;
    let viewScale = 1;
    let dpr = 1;
    let groundY = 575;
    let isPortraitBlocked = false;

    function getSkyBounds() {
        const minY = V_HEIGHT > 900 ? Math.max(220, groundY - 560) : 148;
        const maxY = Math.max(minY + 180, groundY - 48);
        return { minY, maxY };
    }

    function updateViewportAndOrientation() {
        const vv = window.visualViewport;
        const w = Math.round(vv ? vv.width : window.innerWidth) || 1280;
        const h = Math.round(vv ? vv.height : window.innerHeight) || 720;
        const prevGroundY = groundY;

        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);

        if (h > w) {
            // Portrait mobile layout: keep a wide horizontal runner view with controls comfortably below groundY
            V_WIDTH = 820;
            viewScale = w / V_WIDTH;
            V_HEIGHT = Math.max(720, h / viewScale);
            groundY = Math.round(V_HEIGHT * 0.72);
        } else if ((w / (h / 720)) < 960) {
            // Near-square / foldable screen: lock width at 960 so obstacles remain well ahead
            V_WIDTH = 960;
            viewScale = w / V_WIDTH;
            V_HEIGHT = h / viewScale;
            groundY = Math.round(V_HEIGHT * 0.79);
        } else {
            // Standard & widescreen landscape
            V_HEIGHT = 720;
            viewScale = h / V_HEIGHT;
            V_WIDTH = w / viewScale;
            groundY = 575;
        }

        const deltaG = groundY - prevGroundY;
        if (deltaG !== 0 && typeof player !== 'undefined' && player) {
            player.y += deltaG;
            if (Array.isArray(obstaclesList)) obstaclesList.forEach(o => { o.y += deltaG; if (typeof o.targetY === 'number') o.targetY += deltaG; });
            if (Array.isArray(carrotsList)) carrotsList.forEach(c => { c.y += deltaG; });
            if (Array.isArray(powerupsList)) powerupsList.forEach(pw => { pw.y += deltaG; });
            if (Array.isArray(jumpPadsList)) jumpPadsList.forEach(jp => { jp.y += deltaG; });
            if (Array.isArray(skyRingsList)) skyRingsList.forEach(sr => { sr.y += deltaG; });
            if (Array.isArray(laneGatesList)) laneGatesList.forEach(lg => { lg.y += deltaG; });
            if (Array.isArray(feverPortalsList)) feverPortalsList.forEach(fp => { fp.y += deltaG; });
            if (finishCastle) finishCastle.y = groundY;
            if (bossEntity) bossEntity.y += deltaG;
        }

        isPortraitBlocked = false;
        if (rotateOverlayEl) rotateOverlayEl.classList.add('hidden');
    }

    window.addEventListener('resize', updateViewportAndOrientation);
    window.addEventListener('orientationchange', () => setTimeout(updateViewportAndOrientation, 120));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', updateViewportAndOrientation);
    updateViewportAndOrientation();

    // ==================== 7. AUTHENTICATION FLOW ====================
    let authMode = 'login';
    const authForm = document.getElementById('auth-form');
    const authUserInp = document.getElementById('auth-username');
    const authPassInp = document.getElementById('auth-password');
    const authConfInp = document.getElementById('auth-confirm');
    const fieldConfirm = document.getElementById('field-confirm');
    const authErrorEl = document.getElementById('auth-error');
    const authSubmitBtn = document.getElementById('auth-submit');

    document.querySelectorAll('[data-auth-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            authMode = btn.getAttribute('data-auth-tab');
            document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.toggle('active', b === btn));
            fieldConfirm.classList.toggle('hidden', authMode !== 'register');
            authSubmitBtn.textContent = authMode === 'register' ? 'إنشاء الحساب (+50 💎) 🚀' : 'دخول 🚀';
            authErrorEl.textContent = '';
        });
    });

    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        unlockAudio();
        const username = (authUserInp.value || '').trim();
        const password = authPassInp.value || '';
        const confirm = authConfInp.value || '';
        authErrorEl.textContent = '';

        if (!/^[\p{L}\p{N}_]{3,20}$/u.test(username)) {
            authErrorEl.textContent = 'اسم المستخدم لازم يكون من 3 لـ 20 حرف (حروف أو أرقام)';
            return;
        }
        if (password.length < 4) {
            authErrorEl.textContent = 'كلمة المرور لازم تكون 4 حروف أو أكتر';
            return;
        }
        if (authMode === 'register' && password !== confirm) {
            authErrorEl.textContent = 'كلمتا المرور غير متطابقتين';
            return;
        }

        authSubmitBtn.disabled = true;
        try {
            if (serverOnline) {
                const res = await apiCall(authMode, { username, password });
                if (!res.ok) {
                    authErrorEl.textContent = res.error || 'حدث خطأ أثناء التسجيل';
                    authSubmitBtn.disabled = false;
                    return;
                }
                currentUser = { username: res.user.username, token: res.token, progress: normalizeProgress(res.user.progress) };
            } else {
                const db = getLocalAccounts();
                const key = username.toLowerCase();
                if (authMode === 'register') {
                    if (db[key]) {
                        authErrorEl.textContent = 'اسم المستخدم ده مسجل بالفعل، اختر تسجيل الدخول أو اسم تاني';
                        authSubmitBtn.disabled = false;
                        return;
                    }
                    db[key] = { username, pass: btoa(unescape(encodeURIComponent(password))), progress: defaultProgress() };
                    saveLocalAccounts(db);
                } else {
                    if (!db[key] || db[key].pass !== btoa(unescape(encodeURIComponent(password)))) {
                        authErrorEl.textContent = 'اسم المستخدم أو كلمة المرور غلط';
                        authSubmitBtn.disabled = false;
                        return;
                    }
                }
                currentUser = { username: db[key].username, token: '', progress: normalizeProgress(db[key].progress) };
            }

            saveSession();
            authPassInp.value = '';
            authConfInp.value = '';
            onUserAuthenticated();
        } catch (err) {
            authErrorEl.textContent = 'تعذر الاتصال، حاول مرة أخرى';
        } finally {
            authSubmitBtn.disabled = false;
        }
    });

    function onUserAuthenticated() {
        ensureTodayQuests();
        selectedLevelId = currentUser.progress.unlockedLevel || 1;
        selectedWorldFilter = Math.floor((selectedLevelId - 1) / 10);
        if (!currentUser.progress.seenIntro) {
            openIntroScreen();
        } else {
            openHomeScreen();
        }
    }

    async function bootSession() {
        await checkServerAvailable();
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (raw) {
                const saved = JSON.parse(raw);
                if (saved && saved.username) {
                    if (serverOnline && saved.token) {
                        const res = await apiCall('me', { token: saved.token });
                        if (res.ok && res.user) {
                            currentUser = { username: res.user.username, token: saved.token, progress: normalizeProgress(res.user.progress) };
                            onUserAuthenticated();
                            return;
                        }
                    } else if (!serverOnline) {
                        const db = getLocalAccounts();
                        const localAcc = db[saved.username.toLowerCase()];
                        currentUser = { username: saved.username, token: saved.token || '', progress: normalizeProgress(localAcc ? localAcc.progress : saved.progress) };
                        onUserAuthenticated();
                        return;
                    }
                }
            }
        } catch (e) {}
        showOnlyScreen('auth');
    }

    // ==================== 8. INTRO & HOME HUB LOGIC ====================
    let introIdx = 0;
    function openIntroScreen() {
        state = 'MENU';
        stopBGM();
        introIdx = 0;
        renderIntro();
        showOnlyScreen('intro');
    }

    function renderIntro() {
        const s = INTRO_SLIDES[introIdx];
        document.getElementById('intro-badge').textContent = s.badge;
        document.getElementById('intro-title').textContent = s.title;
        document.getElementById('intro-text').textContent = s.text;
        document.getElementById('intro-dots').innerHTML = INTRO_SLIDES.map((_, i) => `<span class="dot ${i === introIdx ? 'active' : ''}"></span>`).join('');
        document.getElementById('btn-intro-next').textContent = introIdx === INTRO_SLIDES.length - 1 ? 'ابدأ المغامرة 🚀' : 'التالي ⬅️';
    }

    document.getElementById('btn-intro-next').addEventListener('click', () => {
        sfxCarrot(2);
        if (introIdx < INTRO_SLIDES.length - 1) {
            introIdx++;
            renderIntro();
        } else {
            currentUser.progress.seenIntro = true;
            syncProgress();
            openHomeScreen();
        }
    });
    document.getElementById('btn-intro-skip').addEventListener('click', () => {
        currentUser.progress.seenIntro = true;
        syncProgress();
        openHomeScreen();
    });

    let activeHubTab = 'levels';
    let selectedPlayMode = 'story'; // 'story' | 'devil' | 'endless' | 'boss'
    let selectedCharSub = 'chars'; // 'chars' | 'pets' | 'boards' | 'trails'
    let selectedWorldSub = 'worlds'; // 'worlds' | 'upgrades' | 'ultimates'
    let selectedQuestSub = 'daily'; // 'daily' | 'achievements'
    let selectedLbSub = 'stars'; // 'stars' | 'trophies' | 'endless' | 'clans'
    let selectedLevelId = 1;
    let selectedWorldFilter = 0;
    let selectedDevilLevelId = 1;
    let selectedDevilChapter = 0;
    let devilPitsList = [];
    let devilScriptQueue = [];

    function openHomeScreen() {
        state = 'MENU';
        stopBGM();
        renderHub();
        showOnlyScreen('home');
    }

    function switchHubTab(tabName) {
        activeHubTab = tabName;
        document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tabName));
        ['levels', 'online', 'chars', 'worlds', 'shop', 'quests', 'leaderboard'].forEach(t => {
            const panel = document.getElementById(`panel-${t}`);
            if (panel) panel.classList.toggle('hidden', t !== activeHubTab);
        });
        renderHub();
        if (activeHubTab === 'leaderboard') loadLeaderboard();
    }

    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchHubTab(btn.getAttribute('data-tab')));
    });

    document.querySelectorAll('[data-playmode]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedPlayMode = btn.getAttribute('data-playmode');
            document.querySelectorAll('[data-playmode]').forEach(b => b.classList.toggle('active', b === btn));
            renderHub();
        });
    });

    document.querySelectorAll('[data-playstyle]').forEach(btn => {
        btn.addEventListener('click', () => {
            const st = btn.getAttribute('data-playstyle');
            setPlayStyle(st, true);
        });
    });

    document.querySelectorAll('[data-charsub]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedCharSub = btn.getAttribute('data-charsub');
            document.querySelectorAll('[data-charsub]').forEach(b => b.classList.toggle('active', b === btn));
            renderHub();
        });
    });

    document.querySelectorAll('[data-worldsub]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedWorldSub = btn.getAttribute('data-worldsub');
            document.querySelectorAll('[data-worldsub]').forEach(b => b.classList.toggle('active', b === btn));
            renderHub();
        });
    });

    document.querySelectorAll('[data-questsub]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedQuestSub = btn.getAttribute('data-questsub');
            document.querySelectorAll('[data-questsub]').forEach(b => b.classList.toggle('active', b === btn));
            renderQuestsPanel();
        });
    });

    document.querySelectorAll('[data-lbsub]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedLbSub = btn.getAttribute('data-lbsub');
            document.querySelectorAll('[data-lbsub]').forEach(b => b.classList.toggle('active', b === btn));
            loadLeaderboard();
        });
    });

    function canSpinFreeNow(p) {
        const last = p.lastSpinTime || 0;
        const lastSec = last > 1e11 ? Math.floor(last / 1000) : last;
        return Math.floor(Date.now() / 1000) - lastSec >= 24 * 60 * 60;
    }

    function canClaimDailyNow(p) {
        return p.lastLoginDate !== todayStr();
    }

    function renderHub() {
        if (!currentUser) return;
        const p = currentUser.progress;
        ensureTodayQuests();

        document.getElementById('hub-username').textContent = currentUser.username;
        document.getElementById('hub-user-title').textContent = p.title || 'أرنوب مغامر';
        document.getElementById('hub-vip-badge').classList.toggle('hidden', !p.vipPass);
        document.getElementById('hub-bank').textContent = p.bankCarrots;
        document.getElementById('hub-gems').textContent = p.gems;
        document.getElementById('hub-trophies').textContent = p.trophies;
        const totalStars = Object.values(p.levelStars).reduce((a, b) => a + b, 0);
        const totalDevilStars = Object.values(p.devilStars || {}).reduce((a, b) => a + b, 0);
        document.getElementById('hub-stars').textContent = selectedPlayMode === 'devil'
            ? `😈 ${totalDevilStars} / 600`
            : `${totalStars} / 300`;

        document.getElementById('spin-dot').classList.toggle('hidden', !canSpinFreeNow(p));
        document.getElementById('daily-dot').classList.toggle('hidden', !canClaimDailyNow(p));

        syncPlayStyleUI();

        // 1. Levels & Play Modes
        const storyWrap = document.getElementById('story-mode-wrap');
        const specialWrap = document.getElementById('special-mode-wrap');
        const devilBanner = document.getElementById('devil-mode-banner');
        if (selectedPlayMode === 'story') {
            storyWrap.classList.remove('hidden');
            specialWrap.classList.add('hidden');
            if (devilBanner) devilBanner.classList.add('hidden');
            const worldBar = document.getElementById('world-bar');
            worldBar.innerHTML = '';
            BIOMES.forEach((b, idx) => {
                const sLvl = idx * 10 + 1;
                const eLvl = idx * 10 + 10;
                const unlocked = p.unlockedLevel >= sLvl;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `world-btn ${idx === selectedWorldFilter ? 'active' : ''} ${unlocked ? '' : 'locked'}`;
                btn.textContent = `${b.icon} ${b.title} (${sLvl}-${eLvl}) ${unlocked ? '' : '🔒'}`;
                btn.addEventListener('click', () => { selectedWorldFilter = idx; renderHub(); });
                worldBar.appendChild(btn);
            });

            const levelsGrid = document.getElementById('levels-grid');
            levelsGrid.innerHTML = '';
            const startId = selectedWorldFilter * 10 + 1;
            for (let id = startId; id < startId + 10; id++) {
                const lvl = LEVELS[id - 1];
                const unlocked = id <= p.unlockedLevel;
                const selected = id === selectedLevelId;
                const stars = p.levelStars[id] || 0;
                const card = document.createElement('button');
                card.type = 'button';
                card.className = `level-card ${unlocked ? '' : 'locked'} ${selected ? 'selected' : ''} ${lvl.isBossStage ? 'is-boss' : ''}`;
                card.innerHTML = `
                    ${unlocked ? '' : '<span class="level-lock">🔒</span>'}
                    <span class="level-icon">${lvl.isBossStage ? '🐉' : lvl.icon}</span>
                    <span class="level-num">${lvl.id}</span>
                    <span class="level-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
                    <span class="level-meta">${lvl.isBossStage ? 'معركة زعيم! 🐉' : `🎯 ${lvl.targetCarrots} 🥕`}</span>
                `;
                card.addEventListener('click', () => {
                    if (!unlocked) { showToast('🔒 أكمل المراحل السابقة لفتح هذا الليفل!'); return; }
                    selectedLevelId = id;
                    renderHub();
                });
                levelsGrid.appendChild(card);
            }
            document.getElementById('btn-play').textContent = `ابدأ الليفل ${selectedLevelId} 🚀`;
        } else if (selectedPlayMode === 'devil') {
            storyWrap.classList.remove('hidden');
            specialWrap.classList.add('hidden');
            const devilUnlocked = Math.max(1, Math.min(TOTAL_DEVIL_LEVELS, p.devilUnlockedLevel || 1));
            if (selectedDevilLevelId > devilUnlocked) selectedDevilLevelId = devilUnlocked;
            if (devilBanner) {
                devilBanner.classList.remove('hidden');
                const curCh = DEVIL_CHAPTERS[selectedDevilChapter];
                devilBanner.innerHTML = `
                    <div class="devil-banner-main">
                        <b>😈 طور المقالب — Level Devil (200 مرحلة ذكية ومميتة!)</b>
                        <span>احذر من الأرضيات اللي بتفتح حُفر 🕳️، الأشواك المخفية، الأعمدة الساقطة، جزر المقالب وباب النهاية الهارب! (${curCh.icon} ${curCh.hint})</span>
                    </div>
                    <div class="devil-banner-stats">
                        <span class="devil-stat-pill">🔓 ${devilUnlocked} / 200</span>
                        <span class="devil-stat-pill">⭐ ${totalDevilStars} / 600</span>
                        <span class="devil-stat-pill">💀 ${p.devilDeaths || 0} مقلب</span>
                    </div>
                `;
            }
            const worldBar = document.getElementById('world-bar');
            worldBar.innerHTML = '';
            DEVIL_CHAPTERS.forEach((ch, idx) => {
                const sLvl = idx * 20 + 1;
                const eLvl = idx * 20 + 20;
                const unlocked = devilUnlocked >= sLvl;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `world-btn is-devil ${idx === selectedDevilChapter ? 'active' : ''} ${unlocked ? '' : 'locked'}`;
                btn.textContent = `${ch.icon} ${ch.title} (${sLvl}-${eLvl}) ${unlocked ? '' : '🔒'}`;
                btn.addEventListener('click', () => { selectedDevilChapter = idx; renderHub(); });
                worldBar.appendChild(btn);
            });

            const levelsGrid = document.getElementById('levels-grid');
            levelsGrid.innerHTML = '';
            const startId = selectedDevilChapter * 20 + 1;
            for (let id = startId; id < startId + 20; id++) {
                const dlvl = DEVIL_LEVELS[id - 1];
                const unlocked = id <= devilUnlocked;
                const selected = id === selectedDevilLevelId;
                const stars = (p.devilStars && p.devilStars[id]) ? p.devilStars[id] : 0;
                const card = document.createElement('button');
                card.type = 'button';
                card.className = `level-card is-devil ${unlocked ? '' : 'locked'} ${selected ? 'selected' : ''}`;
                card.innerHTML = `
                    ${unlocked ? '' : '<span class="level-lock">🔒</span>'}
                    <span class="level-icon">${dlvl.hasRunawayDoor ? '🚪😈' : dlvl.icon}</span>
                    <span class="level-num">${dlvl.id}</span>
                    <span class="level-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
                    <span class="level-meta">${dlvl.hasRunawayDoor ? 'باب هارب! 🏃‍♂️' : `🎯 ${dlvl.targetCarrots} 🥕`}</span>
                `;
                card.addEventListener('click', () => {
                    if (!unlocked) { showToast('😈 خلّص المقلب اللي قبله عشان تفتح المرحلة دي!'); return; }
                    selectedDevilLevelId = id;
                    renderHub();
                });
                levelsGrid.appendChild(card);
            }
            document.getElementById('btn-play').textContent = `ابدأ المقلب ${selectedDevilLevelId} 😈`;
        } else if (selectedPlayMode === 'endless') {
            storyWrap.classList.add('hidden');
            specialWrap.classList.remove('hidden');
            const stObj = getActivePlayStyleObj();
            specialWrap.innerHTML = `
                <div class="special-card">
                    <div class="card-head">
                        <div class="card-ico">♾️</div>
                        <div>
                            <div class="card-title" style="font-size:1.3rem;">الطور اللانهائي — Endless Speed 5D</div>
                            <div class="card-sub">تحدي السرعة القصوى • مكافآت جواهر متواصلة 💎</div>
                        </div>
                    </div>
                    <div class="card-desc">اجري لأطول مسافة ممكنة بدون نهاية! كل 1000 متر بتكسب <b>+5 جواهر مجانية 💎</b> والسرعة بتتصاعد بالتدريج مع مؤثرات السرعة الفائقة.</div>
                    <div class="special-hero-grid">
                        <div class="special-badge"><small>أعلى رقم مسجل ليك</small><b>🏃‍♀️ ${p.endlessHighScore} متر</b></div>
                        <div class="special-badge"><small>طريقة اللعب المُفعّلة</small><b>${stObj.icon} ${stObj.shortName}</b></div>
                        <div class="special-badge"><small>جائزة كل 1000 متر</small><b style="color:#67e8f9">+5 💎 + XP</b></div>
                        <div class="special-badge"><small>نظام التصنيف</small><b style="color:#4ade80">مُدرج في المتصدرين 🏆</b></div>
                    </div>
                    <button type="button" class="btn btn-primary btn-block" id="btn-launch-endless">ابدأ الجري اللانهائي ♾️</button>
                </div>
            `;
            document.getElementById('btn-launch-endless').addEventListener('click', () => startEndlessMode());
            document.getElementById('btn-play').textContent = 'ابدأ اللانهائي ♾️';
        } else {
            storyWrap.classList.add('hidden');
            specialWrap.classList.remove('hidden');
            const stObj = getActivePlayStyleObj();
            specialWrap.innerHTML = `
                <div class="special-card is-boss-hero">
                    <div class="card-head">
                        <div class="card-ico">🐉</div>
                        <div>
                            <div class="card-title" style="font-size:1.3rem;">ساحة الزعماء — Boss Arena 5D</div>
                            <div class="card-sub">معركة ملحمية مباشرة • أسلحة وصواريخ جزر 🚀</div>
                        </div>
                    </div>
                    <div class="card-desc">واجه وحش الأعداء العملاق في معركة مباشرة! تفادى كرات النار واجمع صواريخ الجزر 🚀🥕 لتدمير الزعيم وكسب مكافآت أسطورية فوراً!</div>
                    <div class="special-hero-grid">
                        <div class="special-badge"><small>جائزة الانتصار</small><b style="color:#67e8f9">+30 💎 + 400 🥕</b></div>
                        <div class="special-badge"><small>طريقة اللعب المُفعّلة</small><b>${stObj.icon} ${stObj.shortName}</b></div>
                        <div class="special-badge"><small>الزعماء المحتملين</small><b>🦊 ثعلب • 🐉 تنين • 👾 حارس</b></div>
                        <div class="special-badge"><small>نقاط الباتل باس</small><b style="color:#4ade80">+180 XP 🔥</b></div>
                    </div>
                    <button type="button" class="btn btn-primary btn-block" id="btn-launch-boss">واجه الزعيم الآن 🐉🔥</button>
                </div>
            `;
            document.getElementById('btn-launch-boss').addEventListener('click', () => startBossArena());
            document.getElementById('btn-play').textContent = 'ساحة الزعماء 🐉';
        }

        // 2. Online Modes Grid
        renderOnlineTab();

        // 3. Chars / Pets / Boards / Trails
        renderCharsSection();

        // 4. Worlds / Upgrades / Ultimates
        renderWorldsSection();

        // 5. Shop (TopUp / Chests / Converter)
        renderShopSection();

        // 6. Quests & Achievements
        renderQuestsPanel();
    }

    function renderCharsSection() {
        const p = currentUser.progress;
        const grid = document.getElementById('chars-grid');
        if (!grid) return;
        grid.innerHTML = '';

        if (selectedCharSub === 'chars') {
            BUNNY_CHARS.forEach(ch => {
                const owned = p.ownedChars.includes(ch.id);
                const equipped = p.equippedChar === ch.id;
                const bal = ch.currency === 'gems' ? p.gems : p.bankCarrots;
                const curIco = ch.currency === 'gems' ? '💎' : '🥕';
                const canBuy = !owned && bal >= ch.cost;
                const card = document.createElement('div');
                card.className = `card ${equipped ? 'is-active' : ''} ${ch.currency === 'gems' ? 'is-gem-card' : ''}`;
                card.innerHTML = `
                    <div class="skin-preview" style="background:${ch.previewBg}; height:106px;">
                        <canvas class="char-preview-canvas" width="200" height="106" style="width:200px;height:106px;"></canvas>
                    </div>
                    <div class="card-title">${ch.name}</div>
                    <div class="card-sub">${ch.cost === 0 ? 'مجاني • أساسي' : `السعر: ${ch.cost} ${curIco}`} • ${ch.badge}</div>
                    <div class="card-desc">${ch.desc}<br><b style="color:#4ade80;">⚡ الميزة: ${ch.perkText}</b></div>
                    <button type="button" class="btn ${equipped ? 'btn-gold' : ch.currency === 'gems' ? 'btn-gem' : 'btn-primary'} btn-block" ${(!owned && !canBuy) ? 'disabled' : ''}>
                        ${equipped ? '🐰 مُفعّلة حالياً' : owned ? 'اختيار الشخصية ✨' : `شراء مقابل ${ch.cost} ${curIco}`}
                    </button>
                `;
                const pCanvas = card.querySelector('.char-preview-canvas');
                if (pCanvas) {
                    const pCtx = pCanvas.getContext('2d');
                    pCtx.save();
                    pCtx.translate(102, 98);
                    pCtx.scale(0.64, 0.64);
                    drawBunnyCharacterRig(pCtx, ch, 0.8, 0, 0.25);
                    pCtx.restore();
                }
                card.querySelector('button').addEventListener('click', () => {
                    if (owned) {
                        p.equippedChar = ch.id;
                        sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🐰 تم اختيار ${ch.name}`);
                    } else if (bal >= ch.cost) {
                        if (ch.currency === 'gems') p.gems -= ch.cost; else p.bankCarrots -= ch.cost;
                        p.ownedChars.push(ch.id);
                        p.equippedChar = ch.id;
                        sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🎉 مبروك! فتحت شخصية ${ch.name}`);
                    }
                });
                grid.appendChild(card);
            });
        } else if (selectedCharSub === 'pets') {
            PETS_DATA.forEach(pet => {
                const owned = p.ownedPets.includes(pet.id);
                const equipped = p.equippedPet === pet.id;
                const bal = pet.currency === 'gems' ? p.gems : p.bankCarrots;
                const curIco = pet.currency === 'gems' ? '💎' : '🥕';
                const canBuy = !owned && bal >= pet.cost;
                const card = document.createElement('div');
                card.className = `card ${equipped ? 'is-active' : ''} ${pet.currency === 'gems' ? 'is-gem-card' : ''}`;
                card.innerHTML = `
                    <div class="card-head">
                        <div class="card-ico" style="border:2px solid ${pet.color}">${pet.icon}</div>
                        <div>
                            <div class="card-title">${pet.name}</div>
                            <div class="card-sub">${pet.cost === 0 ? 'مجاني' : `السعر: ${pet.cost} ${curIco}`}</div>
                        </div>
                    </div>
                    <div class="card-desc">${pet.desc}<br><b style="color:#4ade80;">🐾 ${pet.perk}</b></div>
                    <button type="button" class="btn ${equipped ? 'btn-gold' : pet.currency === 'gems' ? 'btn-gem' : 'btn-primary'} btn-block" ${(!owned && !canBuy) ? 'disabled' : ''}>
                        ${equipped ? '🐾 مُفعّل حالياً' : owned ? 'اصطحاب هذا الرفيق ✨' : `شراء مقابل ${pet.cost} ${curIco}`}
                    </button>
                `;
                card.querySelector('button').addEventListener('click', () => {
                    if (owned) {
                        p.equippedPet = pet.id; sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🐾 تم اختيار الرفيق ${pet.name}`);
                    } else if (bal >= pet.cost) {
                        if (pet.currency === 'gems') p.gems -= pet.cost; else p.bankCarrots -= pet.cost;
                        p.ownedPets.push(pet.id); p.equippedPet = pet.id;
                        sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🎉 مبروك! انضم لك ${pet.name}`);
                    }
                });
                grid.appendChild(card);
            });
        } else if (selectedCharSub === 'boards') {
            BOARDS_DATA.forEach(bd => {
                const owned = p.ownedBoards.includes(bd.id);
                const equipped = p.equippedBoard === bd.id;
                const bal = bd.currency === 'gems' ? p.gems : p.bankCarrots;
                const curIco = bd.currency === 'gems' ? '💎' : '🥕';
                const canBuy = !owned && bal >= bd.cost;
                const card = document.createElement('div');
                card.className = `card ${equipped ? 'is-active' : ''} ${bd.currency === 'gems' ? 'is-gem-card' : ''}`;
                card.innerHTML = `
                    <div class="card-head">
                        <div class="card-ico" style="border:2px solid ${bd.color}">${bd.icon}</div>
                        <div>
                            <div class="card-title">${bd.name}</div>
                            <div class="card-sub">${bd.cost === 0 ? 'أساسي' : `السعر: ${bd.cost} ${curIco}`}</div>
                        </div>
                    </div>
                    <div class="card-desc">${bd.desc}${bd.perk ? `<br><b style="color:#67e8f9;">⚡ ${bd.perk}</b>` : ''}</div>
                    <button type="button" class="btn ${equipped ? 'btn-gold' : bd.currency === 'gems' ? 'btn-gem' : 'btn-primary'} btn-block" ${(!owned && !canBuy) ? 'disabled' : ''}>
                        ${equipped ? '🛹 مُفعّلة حالياً' : owned ? 'تفعيل الزلاجة ✨' : `شراء مقابل ${bd.cost} ${curIco}`}
                    </button>
                `;
                card.querySelector('button').addEventListener('click', () => {
                    if (owned) {
                        p.equippedBoard = bd.id; sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🛹 تم تفعيل ${bd.name}`);
                    } else if (bal >= bd.cost) {
                        if (bd.currency === 'gems') p.gems -= bd.cost; else p.bankCarrots -= bd.cost;
                        p.ownedBoards.push(bd.id); p.equippedBoard = bd.id;
                        sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🎉 مبروك! اشتريت ${bd.name}`);
                    }
                });
                grid.appendChild(card);
            });
        } else {
            TRAILS_DATA.forEach(tr => {
                const owned = p.ownedTrails.includes(tr.id);
                const equipped = p.equippedTrail === tr.id;
                const bal = tr.currency === 'gems' ? p.gems : p.bankCarrots;
                const curIco = tr.currency === 'gems' ? '💎' : '🥕';
                const canBuy = !owned && bal >= tr.cost;
                const grad = tr.colors.length > 1 ? `linear-gradient(90deg, ${tr.colors.join(',')})` : tr.colors[0];
                const card = document.createElement('div');
                card.className = `card ${equipped ? 'is-active' : ''}`;
                card.innerHTML = `
                    <div class="skin-preview" style="background:${grad}; height:52px;">${tr.icon}</div>
                    <div class="card-title">${tr.name}</div>
                    <div class="card-sub">${tr.cost === 0 ? 'مجاني' : `السعر: ${tr.cost} ${curIco}`}</div>
                    <div class="card-desc">${tr.desc}</div>
                    <button type="button" class="btn ${equipped ? 'btn-gold' : tr.currency === 'gems' ? 'btn-gem' : 'btn-primary'} btn-block" ${(!owned && !canBuy) ? 'disabled' : ''}>
                        ${equipped ? '✨ مُفعّل حالياً' : owned ? 'تفعيل الأثر ✨' : `شراء مقابل ${tr.cost} ${curIco}`}
                    </button>
                `;
                card.querySelector('button').addEventListener('click', () => {
                    if (owned) {
                        p.equippedTrail = tr.id; sfxPowerup(); syncProgress(); renderHub();
                        showToast(`✨ تم تفعيل ${tr.name}`);
                    } else if (bal >= tr.cost) {
                        if (tr.currency === 'gems') p.gems -= tr.cost; else p.bankCarrots -= tr.cost;
                        p.ownedTrails.push(tr.id); p.equippedTrail = tr.id;
                        sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🎉 مبروك! فتحت ${tr.name}`);
                    }
                });
                grid.appendChild(card);
            });
        }
    }

    function renderWorldsSection() {
        const p = currentUser.progress;
        const grid = document.getElementById('worlds-grid');
        if (!grid) return;
        grid.innerHTML = '';

        if (selectedWorldSub === 'worlds') {
            WORLD_SKINS.forEach(skin => {
                const owned = p.ownedWorlds.includes(skin.id);
                const equipped = p.equippedWorld === skin.id;
                const bal = skin.currency === 'gems' ? p.gems : p.bankCarrots;
                const curIco = skin.currency === 'gems' ? '💎' : '🥕';
                const canBuy = !owned && bal >= skin.cost;
                const card = document.createElement('div');
                card.className = `card ${equipped ? 'is-active' : ''} ${skin.currency === 'gems' ? 'is-gem-card' : ''}`;
                card.innerHTML = `
                    <div class="skin-preview" style="background: linear-gradient(180deg, ${skin.skyTop} 0%, ${skin.skyBottom} 68%, ${skin.groundColor} 68%, ${skin.roadColor} 100%);">
                        <span>${skin.icon}</span>
                    </div>
                    <div class="card-title">${skin.name}</div>
                    <div class="card-sub">${skin.cost === 0 ? 'مجاني' : `السعر: ${skin.cost} ${curIco} • مضاعف الجزر: x${skin.bonusCarrotMult}`}</div>
                    <div class="card-desc">${skin.desc}</div>
                    <button type="button" class="btn ${equipped ? 'btn-gold' : skin.currency === 'gems' ? 'btn-gem' : 'btn-primary'} btn-block" ${(!owned && !canBuy) ? 'disabled' : ''}>
                        ${equipped ? '👑 العالم المُفعّل' : owned ? 'تفعيل هذا العالم ✨' : `شراء مقابل ${skin.cost} ${curIco}`}
                    </button>
                `;
                card.querySelector('button').addEventListener('click', () => {
                    if (owned) {
                        p.equippedWorld = skin.id; sfxPowerup(); syncProgress(); renderHub();
                        showToast(`تم تفعيل ${skin.name}`);
                    } else if (bal >= skin.cost) {
                        if (skin.currency === 'gems') p.gems -= skin.cost; else p.bankCarrots -= skin.cost;
                        p.ownedWorlds.push(skin.id); p.equippedWorld = skin.id;
                        sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🎉 مبروك! اشتريت ${skin.name}`);
                    }
                });
                grid.appendChild(card);
            });
        } else if (selectedWorldSub === 'upgrades') {
            UPGRADE_ITEMS.forEach(item => {
                const lvl = p.upgrades[item.key] || 0;
                const isMax = lvl >= item.maxLevel;
                const cost = isMax ? 0 : item.costs[lvl];
                const canBuy = !isMax && p.bankCarrots >= cost;
                const dots = Array.from({ length: item.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
                const card = document.createElement('div');
                card.className = 'card';
                card.innerHTML = `
                    <div class="card-head">
                        <div class="card-ico">${item.icon}</div>
                        <div><div class="card-title">${item.title}</div><div class="lvl-dots" style="margin-top:4px;">${dots}</div></div>
                    </div>
                    <div class="card-desc">${item.desc}</div>
                    <button type="button" class="btn btn-primary btn-block" ${(!canBuy || isMax) ? 'disabled' : ''}>
                        ${isMax ? '✅ مكتمل للحد الأقصى' : `تطوير مقابل ${cost} 🥕`}
                    </button>
                `;
                card.querySelector('button').addEventListener('click', () => {
                    if (!isMax && p.bankCarrots >= cost) {
                        p.bankCarrots -= cost;
                        p.upgrades[item.key] = lvl + 1;
                        sfxPowerup(); syncProgress(); renderHub();
                        showToast(`⚡ تم تطوير ${item.title}`);
                    }
                });
                grid.appendChild(card);
            });
        } else {
            // Ultimates
            if (!p.ownedUltimates) p.ownedUltimates = ['nova'];
            ULTIMATES_DATA.forEach(ult => {
                const unlocked = ult.cost === 0 || (p.achievements && p.achievements.includes('ult_' + ult.id));
                const equipped = p.equippedUltimate === ult.id;
                const canBuy = !unlocked && p.gems >= ult.cost;
                const card = document.createElement('div');
                card.className = `card ${equipped ? 'is-active' : 'is-gem-card'}`;
                card.innerHTML = `
                    <div class="card-head">
                        <div class="card-ico" style="border:2px solid ${ult.color}">${ult.icon}</div>
                        <div>
                            <div class="card-title">${ult.name}</div>
                            <div class="card-sub">${ult.cost === 0 ? 'مجاني • افتراضي' : `فتح بـ ${ult.cost} 💎`}</div>
                        </div>
                    </div>
                    <div class="card-desc">${ult.desc}</div>
                    <button type="button" class="btn ${equipped ? 'btn-gold' : 'btn-gem'} btn-block" ${(!unlocked && !canBuy) ? 'disabled' : ''}>
                        ${equipped ? '💥 المهارة المُفعّلة' : unlocked ? 'تجهيز المهارة 💥' : `فتح مقابل ${ult.cost} 💎`}
                    </button>
                `;
                card.querySelector('button').addEventListener('click', () => {
                    if (unlocked) {
                        p.equippedUltimate = ult.id; sfxPowerup(); syncProgress(); renderHub();
                        showToast(`💥 تم تجهيز ${ult.name}`);
                    } else if (p.gems >= ult.cost) {
                        p.gems -= ult.cost;
                        if (!p.achievements.includes('ult_' + ult.id)) p.achievements.push('ult_' + ult.id);
                        p.equippedUltimate = ult.id;
                        sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🎉 تم فتح مهارة ${ult.name}`);
                    }
                });
                grid.appendChild(card);
            });
        }
    }

    // ==================== 8B. GEM TOP-UP, CHESTS & CONVERTER ====================
    let pendingTopupPkg = null;
    let selectedPayMethod = 'vodafone';

    function renderShopSection() {
        const p = currentUser.progress;
        const topupGrid = document.getElementById('topup-grid');
        if (topupGrid) {
            topupGrid.innerHTML = '';
            TOPUP_PACKAGES.forEach(pkg => {
                const card = document.createElement('div');
                card.className = 'card is-gem-card';
                card.innerHTML = `
                    ${pkg.hot ? `<span class="badge-hot">${pkg.hot}</span>` : ''}
                    <div class="card-head">
                        <div class="card-ico">${pkg.icon}</div>
                        <div>
                            <div class="card-title">${pkg.gems} جوهرة 💎</div>
                            <div class="card-sub">${pkg.name} • ${pkg.price}</div>
                        </div>
                    </div>
                    <div class="card-desc">هدية مجانية مع الشحن: <b style="color:#fde047">+${pkg.bonusCarrots} 🥕</b>${pkg.vip ? ' + <b style="color:#4ade80;">تفعيل عضوية VIP 👑</b>' : ''}</div>
                    <button type="button" class="btn btn-gem btn-block">شحن الآن (${pkg.price}) 💎</button>
                `;
                card.querySelector('button').addEventListener('click', () => openTopupModal(pkg));
                topupGrid.appendChild(card);
            });
        }

        const chestsGrid = document.getElementById('chests-grid');
        if (chestsGrid) {
            chestsGrid.innerHTML = '';
            CHESTS_DATA.forEach(ch => {
                const bal = ch.currency === 'gems' ? p.gems : p.bankCarrots;
                const curIco = ch.currency === 'gems' ? '💎' : '🥕';
                const canBuy = bal >= ch.cost;
                const card = document.createElement('div');
                card.className = 'card';
                card.innerHTML = `
                    <div class="card-head">
                        <div class="card-ico">${ch.icon}</div>
                        <div>
                            <div class="card-title">${ch.name}</div>
                            <div class="card-sub">التكلفة: ${ch.cost} ${curIco}</div>
                        </div>
                    </div>
                    <div class="card-desc">${ch.desc}</div>
                    <button type="button" class="btn ${ch.currency === 'gems' ? 'btn-gem' : 'btn-gold'} btn-block" ${!canBuy ? 'disabled' : ''}>
                        فتح الصندوق (${ch.cost} ${curIco}) 🎁
                    </button>
                `;
                card.querySelector('button').addEventListener('click', () => openMysteryChest(ch));
                chestsGrid.appendChild(card);
            });
        }

        const exGrid = document.getElementById('exchange-grid');
        if (exGrid) {
            exGrid.innerHTML = '';
            EXCHANGE_PACKS.forEach(ex => {
                const canBuy = p.gems >= ex.gemsCost;
                const card = document.createElement('div');
                card.className = 'card';
                card.innerHTML = `
                    <div class="card-head">
                        <div class="card-ico">🥕</div>
                        <div>
                            <div class="card-title">${ex.carrotsGain} جزرة</div>
                            <div class="card-sub">${ex.label}</div>
                        </div>
                    </div>
                    <button type="button" class="btn btn-primary btn-block" ${!canBuy ? 'disabled' : ''}>تحويل مقابل ${ex.gemsCost} 💎</button>
                `;
                card.querySelector('button').addEventListener('click', () => {
                    if (p.gems >= ex.gemsCost) {
                        p.gems -= ex.gemsCost;
                        p.bankCarrots += ex.carrotsGain;
                        p.totalCarrots += ex.carrotsGain;
                        sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🥕 تم تحويل ${ex.gemsCost} 💎 إلى ${ex.carrotsGain} جزرة!`);
                    }
                });
                exGrid.appendChild(card);
            });
        }
    }

    function openMysteryChest(ch) {
        const p = currentUser.progress;
        if (ch.currency === 'gems' && p.gems < ch.cost) return;
        if (ch.currency === 'carrots' && p.bankCarrots < ch.cost) return;
        if (ch.currency === 'gems') p.gems -= ch.cost; else p.bankCarrots -= ch.cost;

        let msg = '';
        const unownedPets = PETS_DATA.filter(x => !p.ownedPets.includes(x.id));
        const unownedBoards = BOARDS_DATA.filter(x => !p.ownedBoards.includes(x.id));
        const unownedTrails = TRAILS_DATA.filter(x => !p.ownedTrails.includes(x.id));
        const unownedChars = BUNNY_CHARS.filter(x => !p.ownedChars.includes(x.id));

        const roll = Math.random();
        if (ch.id === 'diamond_chest' && unownedChars.length && roll < 0.42) {
            const pick = unownedChars[Math.floor(Math.random() * unownedChars.length)];
            p.ownedChars.push(pick.id);
            msg = `🎉 جائزة أسطورية! ربحت شخصية ${pick.name}!`;
        } else if (ch.id !== 'bronze_chest' && (unownedPets.length || unownedBoards.length || unownedTrails.length) && roll < 0.65) {
            const pool = [
                ...unownedPets.map(x => ({ kind: 'pet', item: x })),
                ...unownedBoards.map(x => ({ kind: 'board', item: x })),
                ...unownedTrails.map(x => ({ kind: 'trail', item: x }))
            ];
            const pick = pool[Math.floor(Math.random() * pool.length)];
            if (pick.kind === 'pet') p.ownedPets.push(pick.item.id);
            else if (pick.kind === 'board') p.ownedBoards.push(pick.item.id);
            else p.ownedTrails.push(pick.item.id);
            msg = `🎁 مبروك! حصلت على ${pick.item.name} من الصندوق!`;
        } else if (ch.id === 'bronze_chest') {
            if (roll < 0.35) {
                const g = 12 + Math.floor(Math.random() * 24);
                p.gems += g;
                msg = `💎 ربحت ${g} جوهرة من الصندوق البرونزي!`;
            } else {
                const c = 400 + Math.floor(Math.random() * 700);
                p.bankCarrots += c; p.totalCarrots += c;
                msg = `🥕 ربحت ${c} جزرة من الصندوق البرونزي!`;
            }
        } else {
            const g = ch.id === 'diamond_chest' ? 220 + Math.floor(Math.random() * 180) : 70 + Math.floor(Math.random() * 75);
            const c = ch.id === 'diamond_chest' ? 3000 : 1200;
            p.gems += g; p.bankCarrots += c; p.totalCarrots += c;
            msg = `💎✨ ربحت ${g} جوهرة + ${c} جزرة!`;
        }
        p.xp += 80;
        sfxPowerup();
        syncProgress();
        renderHub();
        showToast(msg);
    }

    function openTopupModal(pkg) {
        pendingTopupPkg = pkg;
        document.getElementById('topup-pkg-summary').innerHTML = `
            <div>الباقة المختارة: <b>${pkg.name}</b></div>
            <div>الكمية: <b>${pkg.gems} 💎</b> + هدية <b>${pkg.bonusCarrots} 🥕</b> ${pkg.vip ? '+ 👑 VIP' : ''}</div>
            <div>السعر: <b>${pkg.price}</b></div>
        `;
        toggleOverlayModal('topup', true);
    }

    document.getElementById('btn-quick-topup').addEventListener('click', () => {
        switchHubTab('shop');
        showToast('💎 اختر باقة شحن الجواهر المناسبة ليك!');
    });

    document.querySelectorAll('#pay-methods .pay-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedPayMethod = btn.getAttribute('data-method');
            document.querySelectorAll('#pay-methods .pay-btn').forEach(b => b.classList.toggle('active', b === btn));
        });
    });

    document.getElementById('btn-close-topup').addEventListener('click', () => toggleOverlayModal('topup', false));
    document.getElementById('btn-confirm-topup').addEventListener('click', async () => {
        if (!pendingTopupPkg || !currentUser) return;
        const pkg = pendingTopupPkg;
        const confirmBtn = document.getElementById('btn-confirm-topup');
        confirmBtn.disabled = true;
        try {
            if (serverOnline && currentUser.token) {
                const res = await apiCall('topup', { token: currentUser.token, packageId: pkg.id, method: selectedPayMethod });
                if (res.ok && res.user) {
                    currentUser.progress = normalizeProgress(res.user.progress);
                } else {
                    showToast(res.error || 'تعذر إتمام الشحن');
                    confirmBtn.disabled = false;
                    return;
                }
            } else {
                const p = currentUser.progress;
                p.gems += pkg.gems;
                p.bankCarrots += pkg.bonusCarrots;
                p.totalCarrots += pkg.bonusCarrots;
                if (pkg.vip) p.vipPass = true;
                p.topupHistory.push({ pkg: pkg.id, gems: pkg.gems, method: selectedPayMethod, at: Math.floor(Date.now() / 1000) });
            }
            sfxUltimate();
            syncProgress();
            renderHub();
            toggleOverlayModal('topup', false);
            showToast(`💎🎉 تم شحن ${pkg.gems} جوهرة + ${pkg.bonusCarrots} جزرة بنجاح!`);
        } catch (e) {
            showToast('حدث خطأ أثناء الشحن');
        } finally {
            confirmBtn.disabled = false;
        }
    });

    // ==================== 8C. PROMO CODES, SPIN WHEEL, DAILY, BATTLE PASS, PROFILE ====================
    document.getElementById('btn-open-promo').addEventListener('click', () => {
        document.getElementById('promo-status').textContent = '';
        document.getElementById('promo-input').value = '';
        toggleOverlayModal('promo', true);
    });
    document.getElementById('btn-close-promo').addEventListener('click', () => toggleOverlayModal('promo', false));
    document.getElementById('btn-redeem-promo').addEventListener('click', async () => {
        const code = (document.getElementById('promo-input').value || '').trim().toUpperCase();
        const statusEl = document.getElementById('promo-status');
        if (!code) { statusEl.textContent = 'اكتب الكود أولاً'; return; }

        if (serverOnline && currentUser.token) {
            try {
                const res = await apiCall('redeem_code', { token: currentUser.token, code });
                if (!res.ok) { statusEl.textContent = res.error || 'كود غير صالح'; return; }
                currentUser.progress = normalizeProgress(res.user.progress);
                sfxUltimate(); saveSession(); renderHub();
                toggleOverlayModal('promo', false);
                showToast(`🎟️ مبروك! حصلت على ${res.reward.label}!`);
                return;
            } catch (e) {}
        }

        const reward = LOCAL_PROMO_CODES[code];
        if (!reward) { statusEl.textContent = 'كود الهدية غير صحيح'; return; }
        const p = currentUser.progress;
        if (p.redeemedCodes.includes(code)) { statusEl.textContent = 'استخدمت هذا الكود بالفعل!'; return; }
        p.redeemedCodes.push(code);
        p.gems += reward.gems;
        p.bankCarrots += reward.carrots;
        p.totalCarrots += reward.carrots;
        sfxUltimate(); syncProgress(); renderHub();
        toggleOverlayModal('promo', false);
        showToast(`🎟️ مبروك! تم شحن ${reward.label}!`);
    });

    // Lucky Spin Wheel
    let wheelAngle = 0;
    let isSpinning = false;
    function drawSpinWheel() {
        const sc = document.getElementById('spin-canvas');
        if (!sc) return;
        const sctx = sc.getContext('2d');
        const cx = 130, cy = 130, r = 122;
        sctx.clearRect(0, 0, 260, 260);
        const slice = (Math.PI * 2) / SPIN_PRIZES.length;
        SPIN_PRIZES.forEach((pr, idx) => {
            const start = wheelAngle + idx * slice;
            const end = start + slice;
            sctx.beginPath();
            sctx.moveTo(cx, cy);
            sctx.arc(cx, cy, r, start, end);
            sctx.closePath();
            sctx.fillStyle = pr.color;
            sctx.fill();
            sctx.strokeStyle = '#0f172a';
            sctx.lineWidth = 2.5;
            sctx.stroke();

            sctx.save();
            sctx.translate(cx, cy);
            sctx.rotate(start + slice / 2);
            sctx.fillStyle = '#ffffff';
            sctx.font = "900 13px 'Cairo', sans-serif";
            sctx.textAlign = 'right';
            sctx.textBaseline = 'middle';
            sctx.fillText(pr.label, r - 12, 0);
            sctx.restore();
        });
        sctx.beginPath();
        sctx.arc(cx, cy, 18, 0, Math.PI * 2);
        sctx.fillStyle = '#fde047';
        sctx.fill();
        sctx.strokeStyle = '#0f172a';
        sctx.lineWidth = 3;
        sctx.stroke();
    }

    function openSpinModal() {
        const p = currentUser.progress;
        const canFree = canSpinFreeNow(p);
        document.getElementById('btn-spin-free').disabled = !canFree;
        document.getElementById('btn-spin-free').textContent = canFree ? 'لف مجاناً الآن 🎁' : 'اللفة المجانية كل 24 ساعة ⏳';
        document.getElementById('btn-spin-gem').disabled = p.gems < 25;
        document.getElementById('spin-result-msg').textContent = 'لف العجلة واكسب جواهر وجزر مجانية كل يوم!';
        drawSpinWheel();
        toggleOverlayModal('spin', true);
    }

    function triggerSpin(isGem) {
        if (isSpinning || !currentUser) return;
        const p = currentUser.progress;
        if (isGem) {
            if (p.gems < 25) return;
            p.gems -= 25;
        } else {
            if (!canSpinFreeNow(p)) return;
            p.lastSpinTime = Math.floor(Date.now() / 1000);
        }
        isSpinning = true;
        document.getElementById('btn-spin-free').disabled = true;
        document.getElementById('btn-spin-gem').disabled = true;

        const targetIdx = Math.floor(Math.random() * SPIN_PRIZES.length);
        const slice = (Math.PI * 2) / SPIN_PRIZES.length;
        // Pointer is at -Math.PI/2 (top)
        const targetMod = (-Math.PI / 2) - (targetIdx + 0.5) * slice;
        const startAngle = wheelAngle;
        const spins = 5 * Math.PI * 2;
        const delta = spins + ((targetMod - startAngle) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2);
        const duration = 2600;
        const t0 = performance.now();

        function anim(now) {
            const elapsed = Math.min(1, (now - t0) / duration);
            const ease = 1 - Math.pow(1 - elapsed, 3);
            wheelAngle = startAngle + delta * ease;
            drawSpinWheel();
            if (elapsed < 1) {
                requestAnimationFrame(anim);
            } else {
                isSpinning = false;
                const prize = SPIN_PRIZES[targetIdx];
                if (prize.type === 'gems') p.gems += prize.amount;
                else if (prize.type === 'carrots') { p.bankCarrots += prize.amount; p.totalCarrots += prize.amount; }
                else if (prize.type === 'xp') p.xp += prize.amount;
                sfxPowerup();
                syncProgress();
                renderHub();
                document.getElementById('spin-result-msg').innerHTML = `🎉 مبروك! كسبت <b>${prize.label}</b>!`;
                document.getElementById('btn-spin-gem').disabled = p.gems < 25;
                showToast(`🎡 مبروك! ربحت ${prize.label}!`);
            }
        }
        requestAnimationFrame(anim);
    }

    document.getElementById('btn-open-spin').addEventListener('click', openSpinModal);
    document.getElementById('btn-close-spin').addEventListener('click', () => { if (!isSpinning) toggleOverlayModal('spin', false); });
    document.getElementById('btn-spin-free').addEventListener('click', () => triggerSpin(false));
    document.getElementById('btn-spin-gem').addEventListener('click', () => triggerSpin(true));

    // Daily Login Modal
    function openDailyModal() {
        const p = currentUser.progress;
        const canClaim = canClaimDailyNow(p);
        const activeDay = (p.loginStreak % 7) + 1;
        const grid = document.getElementById('daily-grid');
        grid.innerHTML = DAILY_REWARDS.map(r => {
            const claimed = r.day < activeDay || (r.day === activeDay && !canClaim);
            const isToday = r.day === activeDay && canClaim;
            return `
                <div class="daily-day ${claimed ? 'claimed' : ''} ${isToday ? 'today' : ''}">
                    <span>اليوم ${r.day}</span>
                    <span style="font-size:1.5rem;">${r.icon}</span>
                    <span style="color:#fdba74;">+${r.carrots} 🥕</span>
                    <span style="color:#67e8f9;">+${r.gems} 💎</span>
                </div>
            `;
        }).join('');
        const btn = document.getElementById('btn-claim-daily');
        btn.disabled = !canClaim;
        btn.textContent = canClaim ? `استلام مكافأة اليوم ${activeDay} 🎁` : 'تم الاستلام اليوم ✅ تعال بكرة!';
        toggleOverlayModal('daily', true);
    }
    document.getElementById('btn-open-daily').addEventListener('click', openDailyModal);
    document.getElementById('btn-close-daily').addEventListener('click', () => toggleOverlayModal('daily', false));
    document.getElementById('btn-claim-daily').addEventListener('click', () => {
        const p = currentUser.progress;
        if (!canClaimDailyNow(p)) return;
        const dayIdx = p.loginStreak % 7;
        const r = DAILY_REWARDS[dayIdx];
        p.loginStreak++;
        p.lastLoginDate = todayStr();
        p.bankCarrots += r.carrots;
        p.totalCarrots += r.carrots;
        p.gems += r.gems;
        p.xp += 100;
        sfxPowerup(); syncProgress(); renderHub(); openDailyModal();
        showToast(`📅 استلمت مكافأة اليوم: +${r.carrots} 🥕 و +${r.gems} 💎!`);
    });

    // Battle Pass Modal
    function openPassModal() {
        const p = currentUser.progress;
        const tierNum = Math.min(10, Math.floor(p.xp / 200) + 1);
        const pct = Math.min(100, Math.round(((p.xp % 200) / 200) * 100));
        document.getElementById('pass-header-info').textContent = `مستوى الباس: ${tierNum} / 10 • (${p.xp} XP) ${p.vipPass ? '• 👑 VIP مُفعّل' : ''}`;
        document.getElementById('pass-xp-fill').style.width = (tierNum >= 10 ? 100 : pct) + '%';
        const vipBtn = document.getElementById('btn-unlock-vip');
        vipBtn.disabled = p.vipPass || p.gems < 300;
        vipBtn.textContent = p.vipPass ? '👑 باس VIP مُفعّل' : 'تفعيل VIP بـ 300 💎';

        const list = document.getElementById('pass-tiers-list');
        list.innerHTML = '';
        BP_TIERS.forEach(t => {
            const reached = p.xp >= t.xpNeed;
            const fKey = `f_${t.tier}`;
            const vKey = `v_${t.tier}`;
            const fClaimed = p.bpClaimed.includes(fKey);
            const vClaimed = p.bpClaimed.includes(vKey);

            const row = document.createElement('div');
            row.className = 'pass-tier';
            row.innerHTML = `
                <b>مستوى ${t.tier}</b>
                <button type="button" class="btn ${fClaimed ? 'btn-ghost' : 'btn-primary'}" style="min-height:32px;font-size:0.75rem;padding:4px 8px;" ${(!reached || fClaimed) ? 'disabled' : ''} data-claim="${fKey}">
                    مجاني: ${t.free.label} ${fClaimed ? '✅' : reached ? '🎁' : '🔒'}
                </button>
                <button type="button" class="btn ${vClaimed ? 'btn-ghost' : 'btn-gold'}" style="min-height:32px;font-size:0.75rem;padding:4px 8px;" ${(!reached || !p.vipPass || vClaimed) ? 'disabled' : ''} data-claim="${vKey}">
                    VIP: ${t.vip.label} ${vClaimed ? '✅' : (!p.vipPass ? '👑🔒' : reached ? '🎁' : '🔒')}
                </button>
            `;
            row.querySelectorAll('button').forEach(b => {
                b.addEventListener('click', () => {
                    const key = b.getAttribute('data-claim');
                    if (p.bpClaimed.includes(key)) return;
                    const rew = key.startsWith('f_') ? t.free : t.vip;
                    p.bpClaimed.push(key);
                    if (rew.type === 'gems') p.gems += rew.amount;
                    else { p.bankCarrots += rew.amount; p.totalCarrots += rew.amount; }
                    sfxPowerup(); syncProgress(); renderHub(); openPassModal();
                    showToast(`👑 استلمت جائزة الباتل باس: ${rew.label}!`);
                });
            });
            list.appendChild(row);
        });
        toggleOverlayModal('pass', true);
    }
    document.getElementById('btn-open-pass').addEventListener('click', openPassModal);
    document.getElementById('btn-close-pass').addEventListener('click', () => toggleOverlayModal('pass', false));
    document.getElementById('btn-unlock-vip').addEventListener('click', () => {
        const p = currentUser.progress;
        if (!p.vipPass && p.gems >= 300) {
            p.gems -= 300;
            p.vipPass = true;
            sfxUltimate(); syncProgress(); renderHub(); openPassModal();
            showToast('👑 مبروك! تم تفعيل الباتل باس VIP!');
        }
    });

    // Profile & Titles Modal
    function openProfileModal() {
        const p = currentUser.progress;
        const totalStars = Object.values(p.levelStars).reduce((a, b) => a + b, 0);
        document.getElementById('profile-card-content').innerHTML = `
            <div class="stat-box"><small>الاسم</small><b>${escHtml(currentUser.username)}</b></div>
            <div class="stat-box"><small>الكؤوس</small><b>🏆 ${p.trophies}</b></div>
            <div class="stat-box"><small>السباقات (فوز)</small><b>${p.racesWon} / ${p.racesPlayed}</b></div>
            <div class="stat-box"><small>أعلى مسافة لانهائي</small><b>${p.endlessHighScore} م</b></div>
            <div class="stat-box"><small>إجمالي الجزر</small><b>🥕 ${p.totalCarrots}</b></div>
            <div class="stat-box"><small>النجوم</small><b>⭐ ${totalStars}</b></div>
        `;
        const tGrid = document.getElementById('titles-grid');
        tGrid.innerHTML = '';
        TITLES_LIST.forEach(tl => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `title-pill ${p.title === tl ? 'active' : ''}`;
            btn.textContent = tl;
            btn.addEventListener('click', () => {
                p.title = tl;
                syncProgress(); renderHub(); openProfileModal();
                showToast(`🪪 تم تغيير لقبك إلى: ${tl}`);
            });
            tGrid.appendChild(btn);
        });
        toggleOverlayModal('profile', true);
    }
    document.getElementById('btn-open-profile').addEventListener('click', openProfileModal);
    document.getElementById('btn-close-profile').addEventListener('click', () => toggleOverlayModal('profile', false));

    // ==================== 8D. QUESTS, ACHIEVEMENTS, LEADERBOARD & CLANS ====================
    function renderQuestsPanel() {
        if (!currentUser) return;
        const p = currentUser.progress;
        ensureTodayQuests();
        const list = document.getElementById('quests-list');
        if (!list) return;
        list.innerHTML = '';

        if (selectedQuestSub === 'daily') {
            DAILY_QUESTS_DEF.forEach(q => {
                const prog = Math.min(q.target, p.quests[q.key] || 0);
                const done = prog >= q.target;
                const claimed = p.quests.claimed.includes(q.id);
                const pct = Math.round((prog / q.target) * 100);
                const row = document.createElement('div');
                row.className = 'quest-row';
                row.innerHTML = `
                    <div class="quest-info">
                        <div class="card-title">${q.title} (${prog}/${q.target})</div>
                        <div class="muted small">${q.desc} • الجائزة: <b>${q.carrots} 🥕 + ${q.gems} 💎</b></div>
                        <div class="quest-bar"><div class="quest-fill" style="width:${pct}%"></div></div>
                    </div>
                    <button type="button" class="btn ${claimed ? 'btn-ghost' : done ? 'btn-gold' : 'btn-primary'}" ${(!done || claimed) ? 'disabled' : ''}>
                        ${claimed ? 'تم الاستلام ✅' : done ? 'استلام الجائزة 🎁' : 'قيد التنفيذ'}
                    </button>
                `;
                row.querySelector('button').addEventListener('click', () => {
                    if (done && !claimed) {
                        p.quests.claimed.push(q.id);
                        p.bankCarrots += q.carrots; p.totalCarrots += q.carrots;
                        p.gems += q.gems; p.xp += q.xp;
                        sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🎁 استلمت جائزة المهمة: +${q.carrots} 🥕 و +${q.gems} 💎!`);
                    }
                });
                list.appendChild(row);
            });
        } else {
            ACHIEVEMENTS_DEF.forEach(a => {
                const done = a.check(p);
                const claimed = p.achievements.includes(a.id);
                const row = document.createElement('div');
                row.className = 'quest-row';
                row.innerHTML = `
                    <div class="quest-info">
                        <div class="card-title">${a.title}</div>
                        <div class="muted small">${a.desc} • الجائزة: <b style="color:#67e8f9;">+${a.gems} 💎</b> + <b>${a.carrots} 🥕</b></div>
                    </div>
                    <button type="button" class="btn ${claimed ? 'btn-ghost' : done ? 'btn-gem' : 'btn-primary'}" ${(!done || claimed) ? 'disabled' : ''}>
                        ${claimed ? 'مكتمل ✅' : done ? 'استلام 💎' : 'مغلق 🔒'}
                    </button>
                `;
                row.querySelector('button').addEventListener('click', () => {
                    if (done && !claimed) {
                        p.achievements.push(a.id);
                        p.gems += a.gems; p.bankCarrots += a.carrots; p.totalCarrots += a.carrots; p.xp += 150;
                        sfxPowerup(); syncProgress(); renderHub();
                        showToast(`🏅 إنجاز أسطوري! +${a.gems} 💎 و +${a.carrots} 🥕!`);
                    }
                });
                list.appendChild(row);
            });
        }
    }

    async function loadLeaderboard() {
        const listEl = document.getElementById('leaderboard-list');
        const clansPanel = document.getElementById('clans-panel');

        if (selectedLbSub === 'clans') {
            listEl.classList.add('hidden');
            clansPanel.classList.remove('hidden');
            await renderClansPanel();
            return;
        }
        listEl.classList.remove('hidden');
        clansPanel.classList.add('hidden');
        listEl.innerHTML = '<div class="empty">جاري تحميل قائمة المتصدرين...</div>';

        let data = { players: [], trophies: [], endless: [] };
        if (serverOnline) {
            try {
                const res = await apiCall('leaderboard');
                if (res.ok) data = res;
            } catch (e) {}
        }

        let players = selectedLbSub === 'trophies' ? data.trophies : selectedLbSub === 'endless' ? data.endless : data.players;
        if (!players || !players.length) {
            const db = getLocalAccounts();
            players = Object.values(db).map(u => {
                const pr = normalizeProgress(u.progress);
                return {
                    username: u.username,
                    stars: Object.values(pr.levelStars).reduce((a, b) => a + b, 0),
                    level: pr.unlockedLevel,
                    carrots: pr.totalCarrots,
                    trophies: pr.trophies,
                    endless: pr.endlessHighScore,
                    vip: pr.vipPass
                };
            });
            if (currentUser && !players.some(x => x.username.toLowerCase() === currentUser.username.toLowerCase())) {
                const pr = currentUser.progress;
                players.push({
                    username: currentUser.username,
                    stars: Object.values(pr.levelStars).reduce((a, b) => a + b, 0),
                    level: pr.unlockedLevel,
                    carrots: pr.totalCarrots,
                    trophies: pr.trophies,
                    endless: pr.endlessHighScore,
                    vip: pr.vipPass
                });
            }
            if (selectedLbSub === 'trophies') players.sort((a, b) => b.trophies - a.trophies);
            else if (selectedLbSub === 'endless') players.sort((a, b) => b.endless - a.endless);
            else players.sort((a, b) => (b.stars - a.stars) || (b.level - a.level) || (b.carrots - a.carrots));
        }

        if (!players.length) {
            listEl.innerHTML = '<div class="empty">لا يوجد لاعبين بعد، كن أول المتصدرين!</div>';
            return;
        }

        const medals = ['🥇', '🥈', '🥉'];
        listEl.innerHTML = players.slice(0, 25).map((pl, idx) => {
            const isMe = currentUser && pl.username.toLowerCase() === currentUser.username.toLowerCase();
            return `
                <div class="lb-row ${isMe ? 'me' : ''}">
                    <span class="lb-rank">${medals[idx] || (idx + 1)}</span>
                    <span class="lb-name">${pl.vip ? '👑 ' : ''}${escHtml(pl.username)} ${isMe ? '(أنت)' : ''}</span>
                    <span class="lb-stat">${selectedLbSub === 'trophies' ? `🏆 ${pl.trophies}` : selectedLbSub === 'endless' ? `♾️ ${pl.endless}م` : `⭐ ${pl.stars}`}</span>
                    <span class="lb-stat">ليفل ${pl.level}</span>
                    <span class="lb-stat">🥕 ${pl.carrots}</span>
                </div>
            `;
        }).join('');
    }

    async function renderClansPanel() {
        const panel = document.getElementById('clans-panel');
        const p = currentUser.progress;
        let clans = [];
        if (serverOnline) {
            try {
                const res = await apiCall('leaderboard');
                if (res.ok && Array.isArray(res.clans)) clans = res.clans;
            } catch (e) {}
        }
        if (!clans.length) {
            const lClans = getLocalClans();
            clans = Object.keys(lClans).map(cid => ({ id: cid, ...lClans[cid] }));
        }
        const myClan = clans.find(c => c.id === p.clanId);

        panel.innerHTML = `
            <div class="clan-box">
                ${myClan ? `
                    <div class="modal-head-row">
                        <div>
                            <div class="card-title">${escHtml(myClan.badge)} عشيرتك: ${escHtml(myClan.name)}</div>
                            <div class="muted small">الأعضاء: ${myClan.members || 1} • إجمالي الكؤوس: 🏆 ${myClan.trophies || p.trophies}</div>
                        </div>
                        <button type="button" class="btn btn-ghost" id="btn-leave-clan">مغادرة العشيرة</button>
                    </div>
                ` : `
                    <div class="card-title">🛡️ أنشئ عشيرتك الخاصة (1000 🥕) أو انضم لعشيرة</div>
                    <div class="clan-form">
                        <input id="clan-name-inp" class="inline-input" type="text" placeholder="اسم العشيرة (3-24 حرف)..." maxlength="24" />
                        <button type="button" class="btn btn-primary" id="btn-create-clan" ${p.bankCarrots < 1000 ? 'disabled' : ''}>إنشاء عشيرة (1000 🥕)</button>
                    </div>
                `}
            </div>
            <div class="leaderboard" id="clans-list">
                ${clans.length ? clans.map((c, idx) => `
                    <div class="lb-row ${c.id === p.clanId ? 'me' : ''}">
                        <span class="lb-rank">${idx + 1}</span>
                        <span class="lb-name">${escHtml(c.badge)} ${escHtml(c.name)}</span>
                        <span class="lb-stat">👥 ${c.members || 1}</span>
                        <span class="lb-stat">🏆 ${c.trophies || 0}</span>
                        ${(!p.clanId) ? `<button type="button" class="btn btn-ghost" style="min-height:32px;padding:4px 10px;" data-join-clan="${escHtml(c.id)}">انضمام</button>` : '<span class="lb-stat">🛡️</span>'}
                    </div>
                `).join('') : '<div class="empty">لا توجد عشائر بعد — كن أول قائد عشيرة!</div>'}
            </div>
        `;

        const createBtn = document.getElementById('btn-create-clan');
        if (createBtn) {
            createBtn.addEventListener('click', async () => {
                const name = (document.getElementById('clan-name-inp').value || '').trim();
                if (name.length < 3) { showToast('اسم العشيرة لازم يكون 3 حروف على الأقل'); return; }
                if (serverOnline && currentUser.token) {
                    const res = await apiCall('clan_action', { token: currentUser.token, subAction: 'create', name, badge: '🛡️' });
                    if (!res.ok) { showToast(res.error || 'خطأ'); return; }
                    currentUser.progress = normalizeProgress(res.user.progress);
                } else {
                    if (p.bankCarrots < 1000) return;
                    p.bankCarrots -= 1000;
                    const cid = 'clan_' + Date.now();
                    p.clanId = cid;
                    const lc = getLocalClans();
                    lc[cid] = { name, badge: '🛡️', leader: currentUser.username, members: 1, trophies: p.trophies };
                    saveLocalClans(lc);
                }
                sfxPowerup(); syncProgress(); renderHub(); renderClansPanel();
                showToast(`🛡️ مبروك! أنشأت عشيرة ${name}`);
            });
        }
        const leaveBtn = document.getElementById('btn-leave-clan');
        if (leaveBtn) {
            leaveBtn.addEventListener('click', async () => {
                if (serverOnline && currentUser.token) {
                    const res = await apiCall('clan_action', { token: currentUser.token, subAction: 'leave' });
                    if (res.ok && res.user) currentUser.progress = normalizeProgress(res.user.progress);
                } else {
                    p.clanId = '';
                }
                syncProgress(); renderHub(); renderClansPanel();
                showToast('غادرت العشيرة');
            });
        }
        panel.querySelectorAll('[data-join-clan]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const cid = btn.getAttribute('data-join-clan');
                if (serverOnline && currentUser.token) {
                    const res = await apiCall('clan_action', { token: currentUser.token, subAction: 'join', clanId: cid });
                    if (res.ok && res.user) currentUser.progress = normalizeProgress(res.user.progress);
                } else {
                    p.clanId = cid;
                }
                sfxPowerup(); syncProgress(); renderHub(); renderClansPanel();
                showToast('🛡️ تم الانضمام للعشيرة بنجاح!');
            });
        });
    }

    // ==================== 8E. ONLINE MULTIPLAYER LOBBY & RACE SETUP ====================
    let raceLobbyTimer = null;
    let activeRaceRoom = null; // { raceId, mode, roomCode, players, ghostPool }
    let raceLobbyCountdown = 0;

    function renderOnlineTab() {
        const grid = document.getElementById('online-modes-grid');
        const lobby = document.getElementById('race-lobby');
        if (!grid || !lobby) return;

        if (activeRaceRoom) {
            grid.classList.add('hidden');
            lobby.classList.remove('hidden');
            return;
        }
        grid.classList.remove('hidden');
        lobby.classList.add('hidden');
        const p = currentUser.progress;

        grid.innerHTML = `
            <div class="card is-active">
                <div class="card-head">
                    <div class="card-ico">🏎️</div>
                    <div><div class="card-title">السباق السريع أونلاين</div><div class="card-sub">مجاني • 4 متسابقين</div></div>
                </div>
                <div class="card-desc">تنافس ضد 3 أرانب على مضمار واحد! الفائز بالمركز الأول يكسب <b>+25 🏆 كأس</b> + <b>+15 💎 جوهرة</b> + <b>400 🥕</b>!</div>
                <button type="button" class="btn btn-primary btn-block" id="btn-join-quick">دخول سباق سريع 🚀</button>
            </div>
            <div class="card is-gem-card">
                <span class="badge-hot">جائزة كبرى 🔥</span>
                <div class="card-head">
                    <div class="card-ico">💎</div>
                    <div><div class="card-title">بطولة الجواهر المضاعفة</div><div class="card-sub">رسوم الدخول: 20 💎</div></div>
                </div>
                <div class="card-desc">سباق المحترفين! المركز الأول يفوز بـ <b>+65 💎 جوهرة صافية</b> + <b>+40 🏆 كأس</b> + <b>1000 🥕</b>!</div>
                <button type="button" class="btn btn-gem btn-block" id="btn-join-gems" ${p.gems < 20 ? 'disabled' : ''}>دخول البطولة (20 💎)</button>
            </div>
            <div class="card">
                <div class="card-head">
                    <div class="card-ico">🔐</div>
                    <div><div class="card-title">غرفة خاصة مع أصحابك</div><div class="card-sub">شارك الكود مع صحابك</div></div>
                </div>
                <div class="card-desc">أنشئ غرفة بكود خاص أو اكتب كود صاحبك للسباق معاً!</div>
                <input id="private-room-inp" class="inline-input" type="text" placeholder="كود الغرفة (اتركه فارغ للإنشاء)" maxlength="8" style="text-align:center;text-transform:uppercase;" />
                <button type="button" class="btn btn-gold btn-block" id="btn-join-private">إنشاء / انضمام لغرفة خاصة 🏁</button>
            </div>
        `;

        document.getElementById('btn-join-quick').addEventListener('click', () => joinOnlineRaceLobby('quick', ''));
        document.getElementById('btn-join-gems').addEventListener('click', () => joinOnlineRaceLobby('gems', ''));
        document.getElementById('btn-join-private').addEventListener('click', () => {
            const code = (document.getElementById('private-room-inp').value || '').trim().toUpperCase();
            joinOnlineRaceLobby('private', code);
        });
    }

    const AI_BOT_PROFILES = [
        { username: 'سوبر_أرنب', char: 'cyber_bunny', board: 'neon_board', pet: 'cyber_owl' },
        { username: 'الملكة_نورا', char: 'golden_king', board: 'flame_jet', pet: 'star_fairy' },
        { username: 'نينجا_مصر', char: 'ninja_bunny', board: 'none', pet: 'baby_fox' },
        { username: 'فارس_المجرة', char: 'cosmic_legend', board: 'galactic_surf', pet: 'mini_dragon' },
        { username: 'أميرة_الثلج', char: 'snow_princess', board: 'neon_board', pet: 'golden_griffin' }
    ];

    function buildRaceRoster(serverPlayers, ghostPool) {
        const roster = [];
        const p = currentUser.progress;
        // Ensure current player is first in roster display
        roster.push({
            username: currentUser.username,
            char: p.equippedChar,
            board: p.equippedBoard,
            pet: p.equippedPet,
            isMe: true,
            isReal: true
        });
        (serverPlayers || []).forEach(sp => {
            if (sp.username.toLowerCase() !== currentUser.username.toLowerCase() && roster.length < 4) {
                roster.push({ ...sp, isMe: false, isReal: true });
            }
        });
        const ghosts = [...(ghostPool || []), ...AI_BOT_PROFILES];
        let gIdx = 0;
        while (roster.length < 4 && gIdx < ghosts.length) {
            const g = ghosts[gIdx++];
            if (!roster.some(r => r.username.toLowerCase() === g.username.toLowerCase())) {
                roster.push({ ...g, isMe: false, isReal: false });
            }
        }
        return roster;
    }

    async function joinOnlineRaceLobby(mode, roomCode) {
        const p = currentUser.progress;
        if (mode === 'gems' && p.gems < 20) { showToast('محتاج 20 💎 للدخول!'); return; }

        let raceData = {
            raceId: 'local_' + Date.now(),
            mode,
            roomCode: roomCode || Math.random().toString(36).substring(2, 8).toUpperCase(),
            players: [],
            ghostPool: []
        };

        if (serverOnline && currentUser.token) {
            try {
                const res = await apiCall('race_join', { token: currentUser.token, mode, roomCode });
                if (!res.ok) { showToast(res.error || 'تعذر الانضمام للغرفة'); return; }
                raceData = res;
            } catch (e) {}
        }

        activeRaceRoom = {
            raceId: raceData.raceId,
            mode: raceData.mode,
            roomCode: raceData.roomCode,
            roster: buildRaceRoster(raceData.players, raceData.ghostPool)
        };

        raceLobbyCountdown = mode === 'private' ? 8 : 4;
        renderLobbyView();
        renderOnlineTab();

        if (raceLobbyTimer) clearInterval(raceLobbyTimer);
        raceLobbyTimer = setInterval(async () => {
            if (!activeRaceRoom) { clearInterval(raceLobbyTimer); return; }
            raceLobbyCountdown--;
            if (serverOnline && currentUser.token && activeRaceRoom.raceId.startsWith('race_')) {
                try {
                    const st = await apiCall('race_state', { token: currentUser.token, raceId: activeRaceRoom.raceId, pct: 0 });
                    if (st.ok && Array.isArray(st.players)) {
                        activeRaceRoom.roster = buildRaceRoster(st.players, raceData.ghostPool);
                    }
                } catch (e) {}
            }
            renderLobbyView();
            if (raceLobbyCountdown <= 0) {
                clearInterval(raceLobbyTimer);
                launchOnlineRace();
            }
        }, 1000);
    }

    function renderLobbyView() {
        if (!activeRaceRoom) return;
        const codeEl = document.getElementById('lobby-room-code');
        if (activeRaceRoom.mode === 'private') {
            codeEl.classList.remove('hidden');
            codeEl.textContent = `كود الغرفة: ${activeRaceRoom.roomCode}`;
        } else {
            codeEl.classList.add('hidden');
        }
        document.getElementById('lobby-sub').textContent = `ينطلق السباق خلال ${Math.max(0, raceLobbyCountdown)} ثوانٍ... استعد!`;
        document.getElementById('lobby-slots').innerHTML = activeRaceRoom.roster.map(r => {
            const ch = BUNNY_CHARS.find(c => c.id === r.char) || BUNNY_CHARS[0];
            return `
                <div class="slot-card ${r.isMe ? 'me' : ''}">
                    <span class="slot-ico">${ch.icon}</span>
                    <div>
                        <div class="card-title">${escHtml(r.username)} ${r.isMe ? '(أنت)' : ''}</div>
                        <div class="muted small">${r.isReal ? '🟢 متصل الآن' : '🤖 متسابق ذكي'}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    document.getElementById('btn-cancel-race').addEventListener('click', () => {
        if (raceLobbyTimer) clearInterval(raceLobbyTimer);
        activeRaceRoom = null;
        renderOnlineTab();
    });
    document.getElementById('btn-start-race-now').addEventListener('click', () => {
        if (raceLobbyTimer) clearInterval(raceLobbyTimer);
        launchOnlineRace();
    });

    // ==================== 9. GAMEPLAY ENGINE & ALL 20 IN-GAME MECHANICS ====================
    let state = 'BOOT'; // BOOT, MENU, PLAYING, PAUSED, RESULT, REVIVE
    let gameMode = 'story'; // 'story' | 'endless' | 'boss' | 'online'
    let activeLevel = LEVELS[0];
    let levelCarrots = 0;
    let combo = 1;
    let comboTimer = 0;
    let lives = 3;
    let distance = 0;
    let frameCount = 0;
    let worldSpeed = 6.2;
    let shakeFrames = 0;
    let invincibleFrames = 0;
    let slowTimer = 0;

    let magnetTimer = 0;
    let shieldActive = false;
    let boardShieldReady = false;
    let boardShieldCd = 0;
    let dashTimer = 0;
    let dashCooldown = 0;
    let ultCharge = 0;
    let timeWarpTimer = 0;
    let feverTimer = 0;
    let finishCastle = null;
    let reviveUsedThisRun = false;
    let reviveInterval = null;
    let nextEndlessGemDist = 25000; // ~1000m

    // Pet & Boss & Online & PlayStyle state
    let petFireTimer = 0;
    let petFireballs = [];
    let playerLasers = [];
    let skyRingsList = [];
    let laneGatesList = [];
    let nextSkyRingTimer = 210;
    let nextLaneGateTimer = 320;
    let jetpackHoldUp = false;
    let jetpackHoldDown = false;
    let autoLaserTimer = 0;
    let laserBurstCd = 0;
    let bossEntity = null;
    let storyBossSpawned = false;
    let bossProjectiles = [];
    let bossMissiles = [];
    let nextBossMissileTimer = 180;
    let feverPortalsList = [];
    let nextFeverPortalTimer = 900;

    let onlineRacers = [];
    let activeRaceMeta = null;
    let lastRaceSyncAt = 0;
    let pendingEmoteToSend = '';
    let playerEmote = '';
    let playerEmoteTimer = 0;
    let lightningFlash = 0;

    function getActiveChar() {
        const p = currentUser ? currentUser.progress : defaultProgress();
        return BUNNY_CHARS.find(c => c.id === p.equippedChar) || BUNNY_CHARS[0];
    }
    function getActivePet() {
        const p = currentUser ? currentUser.progress : defaultProgress();
        return PETS_DATA.find(x => x.id === p.equippedPet) || PETS_DATA[0];
    }
    function getActiveBoard() {
        const p = currentUser ? currentUser.progress : defaultProgress();
        return BOARDS_DATA.find(x => x.id === p.equippedBoard) || BOARDS_DATA[0];
    }
    function getActiveTrail() {
        const p = currentUser ? currentUser.progress : defaultProgress();
        return TRAILS_DATA.find(x => x.id === p.equippedTrail) || TRAILS_DATA[0];
    }
    function getActiveUltimate() {
        const p = currentUser ? currentUser.progress : defaultProgress();
        return ULTIMATES_DATA.find(x => x.id === p.equippedUltimate) || ULTIMATES_DATA[0];
    }
    function getActivePlayStyle() {
        const p = currentUser ? currentUser.progress : null;
        const id = p && p.playStyle ? p.playStyle : 'runner';
        return PLAY_STYLES_DATA.some(s => s.id === id) ? id : 'runner';
    }
    function getActivePlayStyleObj() {
        const id = getActivePlayStyle();
        return PLAY_STYLES_DATA.find(s => s.id === id) || PLAY_STYLES_DATA[0];
    }
    function getLaneY(laneIdx) {
        const clamped = Math.max(0, Math.min(2, laneIdx));
        return [groundY - 68, groundY - 8, groundY + 54][clamped];
    }
    function assignClosestLane(yPos) {
        const ys = [groundY - 68, groundY - 8, groundY + 54];
        let best = 1, bestDist = 9999;
        for (let i = 0; i < 3; i++) {
            const d = Math.abs(yPos - ys[i]);
            if (d < bestDist) { bestDist = d; best = i; }
        }
        return best;
    }

    function syncPlayStyleUI() {
        const stObj = getActivePlayStyleObj();
        document.querySelectorAll('[data-playstyle]').forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-playstyle') === stObj.id);
        });
        const hudIco = document.getElementById('hud-style-ico');
        const hudTxt = document.getElementById('hud-style-txt');
        if (hudIco) hudIco.textContent = stObj.icon;
        if (hudTxt) hudTxt.textContent = stObj.shortName;

        const jIco = document.getElementById('tc-jump-ico');
        const jTxt = document.getElementById('tc-jump-txt');
        const sIco = document.getElementById('tc-slide-ico');
        const sTxt = document.getElementById('tc-slide-txt');
        const dIco = document.getElementById('tc-dash-ico');
        const dTxt = document.getElementById('tc-dash-txt');
        if (jIco) jIco.textContent = stObj.touchJumpIco;
        if (jTxt) jTxt.textContent = stObj.touchJumpTxt;
        if (sIco) sIco.textContent = stObj.touchSlideIco;
        if (sTxt) sTxt.textContent = stObj.touchSlideTxt;
        if (dIco) dIco.textContent = stObj.touchDashIco;
        if (dTxt) dTxt.textContent = stObj.touchDashTxt;

        const hintEl = document.getElementById('controls-hint');
        if (hintEl) {
            hintEl.innerHTML = isTouchDevice ? stObj.hintTouch : stObj.hintKey;
        }
    }

    function setPlayStyle(styleId, notify = true) {
        const valid = PLAY_STYLES_DATA.find(s => s.id === styleId);
        if (!valid) return;
        if (currentUser) {
            currentUser.progress.playStyle = valid.id;
            syncProgress();
        }
        jetpackHoldUp = false;
        jetpackHoldDown = false;
        playerLasers = [];
        skyRingsList = [];
        laneGatesList = [];

        if (valid.id === 'lanes') {
            player.lane = 1;
            player.hopY = 0;
            player.hopVy = 0;
            player.y = getLaneY(1);
            player.vy = 0;
            player.isSliding = false;
            obstaclesList.forEach(o => { o.lane = assignClosestLane(o.y); o.y = getLaneY(o.lane); o.isAerial = false; o.hitOffsetY = 0; });
            carrotsList.forEach(c => { c.lane = assignClosestLane(c.y + 32); c.y = getLaneY(c.lane) - 32; });
            powerupsList.forEach(pw => { pw.lane = assignClosestLane(pw.y + 36); pw.y = getLaneY(pw.lane) - 36; });
        } else if (valid.id === 'jetpack') {
            player.lane = 1;
            player.hopY = 0;
            player.hopVy = 0;
            player.y = Math.min(player.y, groundY - 140);
            player.vy = -2;
            player.isSliding = false;
            obstaclesList.forEach(o => { o.lane = null; o.y = Math.min(o.y, groundY - 40); });
            carrotsList.forEach(c => { c.lane = null; c.y = Math.min(c.y, groundY - 50); });
            powerupsList.forEach(pw => { pw.lane = null; pw.y = Math.min(pw.y, groundY - 80); });
        } else {
            player.lane = 1;
            player.hopY = 0;
            player.hopVy = 0;
            player.y = Math.min(player.y, groundY);
            player.vy = 0;
            player.jumpsLeft = 2;
            obstaclesList.forEach(o => {
                o.lane = null;
                if (o.isAerial) { o.y = Math.min(o.y, groundY - 75); }
                else { o.y = o.type === 'smart_drone' ? groundY - 60 : groundY; }
            });
            carrotsList.forEach(c => { c.lane = null; c.y = Math.min(c.y, groundY - 36); });
            powerupsList.forEach(pw => { pw.lane = null; pw.y = Math.min(pw.y, groundY - 105); });
        }

        if (state === 'PLAYING' || state === 'PAUSED') {
            invincibleFrames = Math.max(invincibleFrames, 45);
            addFloatingText(`${valid.icon} ${valid.name}`, V_WIDTH * 0.5, V_HEIGHT * 0.28, '#22d3ee', 26);
        }
        syncPlayStyleUI();
        if (notify) {
            sfxPowerup();
            showToast(`${valid.icon} تم تفعيل طريقة اللعب: ${valid.name}`);
        }
    }

    function getActiveVisualTheme() {
        const p = currentUser ? currentUser.progress : defaultProgress();
        const skinId = p.equippedWorld || 'auto';
        if (skinId !== 'auto') {
            const skin = WORLD_SKINS.find(s => s.id === skinId);
            if (skin) return skin;
        }
        return {
            skyTop: activeLevel.skyTop, skyBottom: activeLevel.skyBottom,
            hillColor1: activeLevel.hillColor1, hillColor2: activeLevel.hillColor2,
            groundColor: activeLevel.groundColor, roadColor: activeLevel.roadColor,
            weather: activeLevel.weather, sunColor: '#fde047',
            treeCrown: activeLevel.groundColor, treeTrunk: '#3f2e21', bonusCarrotMult: 1
        };
    }

    function fireLaserBurst(count = 1) {
        if (state !== 'PLAYING' || isPortraitBlocked) return;
        const py = player.y - 54;
        const angles = count === 3 ? [-2.6, 0, 2.6] : [0];
        angles.forEach(vy => {
            playerLasers.push({ x: player.x + 36, y: py, vx: 21, vy, life: 70 });
        });
        playTone(count === 3 ? 820 : 660, 'sawtooth', 0.08, 0.1, 320);
    }

    const player = {
        x: 160, y: 575, vy: 0, gravity: 0.78, jumpForce: -16.4,
        jumpsLeft: 2, isSliding: false, slideTimer: 0, runCycle: 0, earBounce: 0, trail: [],
        lane: 1, hopY: 0, hopVy: 0,
        getDesiredX() { return Math.max(90, Math.min(195, V_WIDTH * 0.16)); },
        getVisualY() { return getActivePlayStyle() === 'lanes' ? (this.y + this.hopY) : this.y; },
        reset() {
            const ps = getActivePlayStyle();
            this.x = this.getDesiredX();
            this.lane = 1; this.hopY = 0; this.hopVy = 0;
            this.y = ps === 'lanes' ? getLaneY(1) : ps === 'jetpack' ? groundY - 180 : groundY;
            this.vy = 0;
            this.jumpsLeft = 2; this.isSliding = false; this.slideTimer = 0; this.trail = [];
        },
        laneHop() {
            if (state !== 'PLAYING' || isPortraitBlocked) return;
            if (this.hopY >= -4) {
                this.hopVy = -13.5;
                sfxJump();
                spawnJumpDust(this.x, this.y);
                spawnShockwave(this.x, this.y, '#22d3ee', 75, 5);
            }
        },
        jump() {
            if (state !== 'PLAYING' || isPortraitBlocked) return;
            const ps = getActivePlayStyle();
            if (ps === 'jetpack') {
                this.vy = -8.6;
                sfxJump();
                spawnJumpDust(this.x - 14, this.y - 25);
                return;
            }
            if (ps === 'lanes') {
                if (this.lane > 0) {
                    this.lane--;
                    sfxSlide();
                    spawnJumpDust(this.x, this.y);
                } else {
                    this.laneHop();
                }
                return;
            }
            if (this.isSliding) { this.isSliding = false; this.slideTimer = 0; }
            if (this.jumpsLeft > 0) {
                const bd = getActiveBoard();
                const jBoost = bd.id === 'flame_jet' ? 1.08 : 1.0;
                this.vy = (this.jumpsLeft === 2 ? this.jumpForce : this.jumpForce * 0.88) * jBoost;
                this.jumpsLeft--;
                sfxJump();
                spawnJumpDust(this.x, this.y);
                spawnShockwave(this.x, this.y, this.jumpsLeft === 0 ? '#fde047' : '#38bdf8', 70, 5);
            }
        },
        slide() {
            if (state !== 'PLAYING' || isPortraitBlocked) return;
            const ps = getActivePlayStyle();
            if (ps === 'jetpack') {
                this.vy = 9.2;
                sfxSlide();
                return;
            }
            if (ps === 'lanes') {
                if (this.lane < 2) {
                    this.lane++;
                    sfxSlide();
                    spawnJumpDust(this.x, this.y);
                } else if (this.hopY < 0) {
                    this.hopVy = 14;
                }
                return;
            }
            if (this.y < groundY - 10) this.vy = 19;
            this.isSliding = true; this.slideTimer = 40;
            sfxSlide();
        },
        dash() {
            if (state !== 'PLAYING' || isPortraitBlocked) return;
            const ps = getActivePlayStyle();
            if (ps === 'jetpack') {
                if (laserBurstCd <= 0) {
                    fireLaserBurst(3);
                    laserBurstCd = 16;
                }
                if (dashCooldown > 0) return;
            } else if (ps === 'lanes') {
                this.laneHop();
                if (dashCooldown > 0) return;
            } else if (dashCooldown > 0) {
                return;
            }
            const upg = currentUser ? (currentUser.progress.upgrades.dashPower || 0) : 0;
            const ch = getActiveChar();
            dashTimer = 28 + upg * 6;
            dashCooldown = Math.max(55, 165 - upg * 28 - (ch.dashBonus || 0));
            invincibleFrames = Math.max(invincibleFrames, dashTimer + 12);
            if (ps === 'runner') this.vy = 0;
            sfxDash();
            trackQuest('dashes', 1);
            spawnShockwave(this.x, this.getVisualY() - 45, ch.trailColor || '#38bdf8', 115, 7);
            addFloatingText(ps === 'jetpack' ? 'نيترو نفاث! 🚀' : 'انطلاق نيترو! ⚡', this.x + 40, this.getVisualY() - 110, ch.trailColor || '#38bdf8', 22);
        },
        activateUltimate() {
            if (state !== 'PLAYING' || isPortraitBlocked || ultCharge < 100) return;
            ultCharge = 0;
            const ult = getActiveUltimate();
            sfxUltimate();
            shakeFrames = 14;
            spawnShockwave(this.x, this.getVisualY() - 50, ult.color || '#f43f5e', 340, 14);

            if (ult.id === 'nova') {
                const blown = obstaclesList.length;
                obstaclesList.forEach(o => spawnCarrotSparkles(o.x, o.y - 25, true));
                obstaclesList = [];
                bossProjectiles = [];
                if (bossEntity) damageBoss(25);
                const bonus = 20 + blown * 3;
                levelCarrots += bonus;
                if (currentUser) { currentUser.progress.bankCarrots += bonus; currentUser.progress.totalCarrots += bonus; }
                dashTimer = Math.max(dashTimer, 36);
                invincibleFrames = Math.max(invincibleFrames, 65);
                addFloatingText(`💥 انفجار كوني! +${bonus} 🥕`, V_WIDTH * 0.45, V_HEIGHT * 0.35, '#f43f5e', 28);
            } else if (ult.id === 'time_warp') {
                timeWarpTimer = 360;
                magnetTimer = Math.max(magnetTimer, 360);
                shieldActive = true;
                addFloatingText('⏳ تباطؤ الزمن + مغناطيس عملاق!', V_WIDTH * 0.45, V_HEIGHT * 0.35, '#22d3ee', 26);
            } else {
                invincibleFrames = Math.max(invincibleFrames, 180);
                const ps = getActivePlayStyle();
                const skyB = getSkyBounds();
                for (let i = 0; i < 16; i++) {
                    const lIdx = i % 3;
                    carrotsList.push({
                        x: V_WIDTH * 0.25 + i * 52,
                        y: ps === 'lanes' ? getLaneY(lIdx) - 30 : ps === 'jetpack' ? skyB.minY + 35 + (i % 4) * 65 : groundY - 50 - (i % 4) * 38,
                        lane: lIdx,
                        radius: 24, bobOffset: i * 0.4, isGolden: true
                    });
                }
                addFloatingText('🥕✨ عاصفة الجزر الذهبي!', V_WIDTH * 0.45, V_HEIGHT * 0.35, '#fbbf24', 28);
            }
            updateHUD(true);
        },
        update() {
            this.x = this.getDesiredX();
            const ps = getActivePlayStyle();

            if (ps === 'jetpack') {
                if (jetpackHoldUp) {
                    this.vy = Math.max(-10.5, this.vy - 1.15);
                } else if (jetpackHoldDown) {
                    this.vy = Math.min(11.5, this.vy + 1.25);
                } else {
                    this.vy += 0.38;
                }
                this.vy = Math.max(-11, Math.min(11.5, this.vy));
                if (dashTimer > 0) {
                    dashTimer--;
                    this.vy *= 0.85;
                }
                this.y += this.vy;
                const minFlyY = getSkyBounds().minY;
                const maxFlyY = groundY - 12;
                if (this.y < minFlyY) { this.y = minFlyY; this.vy = Math.max(0, this.vy); }
                if (this.y > maxFlyY) { this.y = maxFlyY; this.vy = Math.min(0, this.vy); }
                this.isSliding = false;
                this.jumpsLeft = 2;
            } else if (ps === 'lanes') {
                if (dashTimer > 0) dashTimer--;
                const targetY = getLaneY(this.lane);
                this.y += (targetY - this.y) * 0.32;
                if (Math.abs(targetY - this.y) < 0.8) this.y = targetY;

                if (this.hopY < 0 || this.hopVy < 0) {
                    this.hopY += this.hopVy;
                    this.hopVy += 0.82;
                    if (this.hopY >= 0) { this.hopY = 0; this.hopVy = 0; }
                }
                this.vy = 0;
                this.isSliding = false;
            } else {
                if (dashTimer > 0) {
                    dashTimer--;
                    this.vy = 0;
                } else {
                    this.y += this.vy;
                    if (this.y < groundY) this.vy += this.gravity;
                    else { this.y = groundY; this.vy = 0; this.jumpsLeft = 2; }
                }
            }

            if (dashCooldown > 0) dashCooldown--;
            if (laserBurstCd > 0) laserBurstCd--;

            const vyRef = this.getVisualY();
            if (frameCount % 2 === 0) {
                this.trail.push({ x: this.x - 16, y: vyRef - (this.isSliding ? 25 : 50), alpha: 0.9, size: 8 + Math.random() * 6 });
                if (this.trail.length > 14) this.trail.shift();
            }
            for (let i = this.trail.length - 1; i >= 0; i--) {
                this.trail[i].x -= worldSpeed * 0.78;
                this.trail[i].alpha -= 0.065;
                if (this.trail[i].alpha <= 0) this.trail.splice(i, 1);
            }
            if (this.isSliding) {
                this.slideTimer--;
                if (this.slideTimer <= 0) this.isSliding = false;
            }
            this.runCycle += worldSpeed * 0.048;
            this.earBounce = Math.sin(this.runCycle * 2) * 5;
        },
        getHitbox() {
            const vyRef = this.getVisualY();
            const h = this.isSliding ? 38 : 76;
            const w = 24;
            return { x: this.x - w / 2, y: vyRef - h - 4, width: w, height: h };
        },
        getCollectBox() {
            const vyRef = this.getVisualY();
            const h = this.isSliding ? 92 : 154;
            const w = 78;
            return { x: this.x - w / 2 + 4, y: vyRef - h, width: w, height: h };
        }
    };

    let carrotsList = [];
    let obstaclesList = [];
    let powerupsList = [];
    let jumpPadsList = [];
    let particlesList = [];
    let shockwavesList = [];
    let fgBokehList = [];
    let weatherParticles = [];
    let shootingStars = [];
    let floatingTexts = [];
    let confettiList = [];
    let bgTreesList = [];

    function spawnShockwave(x, y, color = '#22d3ee', maxR = 95, speed = 5) {
        if (shockwavesList.length >= 12) shockwavesList.shift();
        shockwavesList.push({ x, y, r: 10, maxR, speed, color, alpha: 0.9 });
    }

    function initScenery() {
        bgTreesList = [];
        for (let i = 0; i < 9; i++) {
            bgTreesList.push({ x: i * 220 + Math.random() * 80, scale: 0.75 + Math.random() * 0.5 });
        }
        weatherParticles = [];
        for (let i = 0; i < 36; i++) {
            weatherParticles.push({
                x: Math.random() * 1600, y: Math.random() * V_HEIGHT,
                size: 2 + Math.random() * 3.5, vx: -1 - Math.random() * 2,
                vy: (Math.random() - 0.5) * 1.5, phase: Math.random() * Math.PI * 2
            });
        }
        fgBokehList = [];
        const bokehColors = ['rgba(34,211,238,0.16)', 'rgba(251,191,36,0.14)', 'rgba(168,85,247,0.16)', 'rgba(244,63,94,0.13)'];
        for (let i = 0; i < 12; i++) {
            fgBokehList.push({
                x: Math.random() * 1600,
                y: Math.random() * V_HEIGHT,
                r: 18 + Math.random() * 38,
                vx: -1.4 - Math.random() * 2.2,
                vy: (Math.random() - 0.5) * 0.55,
                color: bokehColors[i % bokehColors.length],
                phase: Math.random() * Math.PI * 2
            });
        }
        shootingStars = [];
    }
    initScenery();

    let nextCarrotTimer = 20;
    let nextPowerupTimer = 220;

    function resetCommonRunState() {
        const upg = currentUser ? currentUser.progress.upgrades : { maxLives: 0, magnetDuration: 0 };
        const ch = getActiveChar();
        const pet = getActivePet();
        const bd = getActiveBoard();

        levelCarrots = 0;
        combo = 1;
        comboTimer = 0;
        lives = gameMode === 'devil' ? 1 : 3 + (upg.maxLives || 0) + (ch.extraLives || 0);
        distance = 0;
        frameCount = 0;
        invincibleFrames = gameMode === 'devil' ? 30 : 45;
        shakeFrames = 0;
        slowTimer = 0;
        reviveUsedThisRun = false;

        magnetTimer = gameMode === 'devil' ? 0 : (upg.magnetDuration || 0) * 180 + (ch.id === 'cyber_bunny' || ch.id === 'cosmic_legend' || ch.id === 'diamond_empress' ? 300 : 0);
        shieldActive = gameMode === 'devil' ? false : (((upg.maxLives || 0) >= 2) || Boolean(ch.autoShield));
        boardShieldReady = gameMode === 'devil' ? false : bd.id !== 'none';
        boardShieldCd = 0;
        dashTimer = 0;
        dashCooldown = 0;
        ultCharge = 0;
        timeWarpTimer = 0;
        feverTimer = 0;
        petFireTimer = 0;
        jetpackHoldUp = false;
        jetpackHoldDown = false;
        autoLaserTimer = 0;
        laserBurstCd = 0;

        carrotsList = []; obstaclesList = []; powerupsList = []; jumpPadsList = [];
        devilPitsList = []; devilScriptQueue = [];
        particlesList = []; shockwavesList = []; floatingTexts = []; confettiList = [];
        petFireballs = []; bossProjectiles = []; bossMissiles = []; feverPortalsList = [];
        playerLasers = []; skyRingsList = []; laneGatesList = [];
        finishCastle = null; bossEntity = null; storyBossSpawned = false;
        nextCarrotTimer = 18; nextPowerupTimer = 210;
        nextSkyRingTimer = 200; nextLaneGateTimer = 300;
        nextBossMissileTimer = 140; nextFeverPortalTimer = 750;
        playerEmote = ''; playerEmoteTimer = 0;

        if (pet.id === 'baby_fox') {
            levelCarrots += 5;
            if (currentUser) { currentUser.progress.bankCarrots += 5; currentUser.progress.totalCarrots += 5; }
        }
        player.reset();
        syncPlayStyleUI();
        state = 'PLAYING';
        showOnlyScreen(null);
        startBGM();
    }

    function spawnBoss(tier = 1) {
        const names = ['🦊 ثعلب الظلام الآلي', '🐉 تنين الحمم الأعظم', '👾 حارس المجرة الشرير'];
        const icons = ['🦊', '🐉', '👾'];
        const idx = (tier - 1) % 3;
        bossEntity = {
            name: names[idx],
            icon: icons[idx],
            hp: 100,
            maxHp: 100,
            x: V_WIDTH - 140,
            y: groundY - 140,
            atkTimer: 90
        };
        addFloatingText(`⚠️ ظهر الزعيم: ${bossEntity.name}!`, V_WIDTH * 0.5, V_HEIGHT * 0.3, '#f43f5e', 28);
    }

    function damageBoss(dmg) {
        if (!bossEntity) return;
        bossEntity.hp = Math.max(0, bossEntity.hp - dmg);
        shakeFrames = 8;
        spawnCarrotSparkles(bossEntity.x, bossEntity.y, true);
        spawnShockwave(bossEntity.x, bossEntity.y, '#f43f5e', 110, 6);
        addFloatingText(`-${dmg} 💥`, bossEntity.x - 30, bossEntity.y - 60, '#fbbf24', 26);
        if (bossEntity.hp <= 0) {
            const bName = bossEntity.name;
            bossEntity = null;
            bossProjectiles = [];
            bossMissiles = [];
            addFloatingText(`🏆 تم هزيمة ${bName}!`, V_WIDTH * 0.5, V_HEIGHT * 0.32, '#4ade80', 30);
            if (gameMode === 'boss') {
                completeBossArenaVictory();
            }
        }
    }

    function startLevel(lvlId) {
        unlockAudio();
        updateViewportAndOrientation();
        gameMode = 'story';
        activeRaceMeta = null;
        onlineRacers = [];
        selectedLevelId = Math.max(1, Math.min(TOTAL_LEVELS, lvlId));
        activeLevel = LEVELS[selectedLevelId - 1];
        resetCommonRunState();
        if (activeLevel.isBossStage) {
            // Boss spawns mid-level
        }
        updateHUD(true);
        addFloatingText(`🚩 ليفل ${activeLevel.id} / 100`, V_WIDTH * 0.5, V_HEIGHT * 0.35, '#4ade80', 28);
    }

    function makeDevilPrng(seed) {
        let s = (seed || 1) % 2147483647;
        if (s <= 0) s += 2147483646;
        return function () {
            s = (s * 16807) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }

    function buildDevilStageTraps(lvlId) {
        devilScriptQueue = [];
        const rand = makeDevilPrng(lvlId * 7919 + 42);
        const pool = ['hidden_spikes', 'sink_floor', 'sliding_spike'];
        if (lvlId >= 21) pool.push('falling_pillar');
        if (lvlId >= 41) pool.push('troll_carrot');
        if (lvlId >= 61) pool.push('troll_saw');
        if (lvlId >= 101) pool.push('laser_gate', 'smart_drone');

        const baseGap = Math.max(365, 455 - Math.floor(lvlId * 0.42));
        let d = 380;
        while (d < activeLevel.levelLength - 580) {
            const trapType = pool[Math.floor(rand() * pool.length)];
            const subMode = rand() < 0.45 ? 'low' : 'ground';
            const reverseDir = rand() < 0.58;
            const lane = Math.floor(rand() * 3);
            devilScriptQueue.push({ spawnDist: d, trapType, subMode, reverseDir, lane });
            d += baseGap + Math.floor(rand() * 95);
        }
    }

    function spawnDevilTrapEvent(ev) {
        const ps = getActivePlayStyle();
        const startX = V_WIDTH + 90;

        if (ev.trapType === 'sink_floor') {
            if (ps === 'runner') {
                devilPitsList.push({
                    x: startX,
                    width: Math.min(112, 86 + Math.floor(activeLevel.id * 0.14)),
                    openProgress: 0,
                    triggered: false,
                    triggerDist: 255,
                    passed: false
                });
                return;
            }
            // Fallback in jetpack/lanes mode: spawn a sharp hazard on that plane
            ev.trapType = ps === 'jetpack' ? 'troll_saw' : 'hidden_spikes';
        }

        const skyB = getSkyBounds();
        const baseY = ps === 'lanes'
            ? getLaneY(ev.lane)
            : (ps === 'jetpack' ? skyB.minY + 35 + (ev.lane * ((skyB.maxY - skyB.minY - 60) / 2)) : groundY);

        let obs = null;
        if (ev.trapType === 'hidden_spikes') {
            obs = {
                type: 'hidden_spikes', x: startX, y: baseY, lane: ev.lane,
                vx: 0, triggered: false, triggerDist: 250, popProgress: 0,
                hitW: 48, hitH: 42, hitOffsetY: 0, isAerial: ps === 'jetpack'
            };
        } else if (ev.trapType === 'sliding_spike') {
            obs = {
                type: 'sliding_spike', x: startX, y: baseY, lane: ev.lane,
                vx: 0, triggered: false, triggerDist: 280, slideShift: ev.reverseDir ? 3.2 : -2.2,
                hitW: 40, hitH: 40, hitOffsetY: 0, isAerial: ps === 'jetpack'
            };
        } else if (ev.trapType === 'falling_pillar') {
            const dropTargetY = ps === 'lanes' ? baseY : (ev.subMode === 'low' ? groundY - 56 : groundY);
            obs = {
                type: 'falling_pillar',
                x: startX,
                y: ps === 'jetpack' ? baseY : Math.max(95, dropTargetY - 220),
                targetY: dropTargetY,
                lane: ev.lane,
                vx: 0, vy: 0, triggered: false, triggerDist: 265,
                isLowPass: ps === 'runner' && ev.subMode === 'low',
                hitW: 42, hitH: ev.subMode === 'low' ? 84 : 62, hitOffsetY: 0,
                isAerial: ps === 'jetpack'
            };
        } else if (ev.trapType === 'troll_saw') {
            obs = {
                type: 'troll_saw', x: startX, y: baseY, lane: ev.lane,
                vx: 0, vy: 0, rot: 0, jumped: false,
                hitW: 38, hitH: 38, hitOffsetY: 0, isAerial: ps === 'jetpack'
            };
        } else if (ev.trapType === 'troll_carrot') {
            obs = {
                type: 'troll_carrot', x: startX, y: ps === 'runner' ? groundY - 12 : baseY, lane: ev.lane,
                vx: 0, triggered: false, triggerDist: 215,
                hitW: 28, hitH: 36, hitOffsetY: 0, isAerial: ps === 'jetpack'
            };
        } else if (ev.trapType === 'laser_gate') {
            obs = {
                type: 'laser_gate', x: startX, y: ps === 'runner' ? groundY : baseY, lane: ev.lane,
                vx: 0, cycle: 75, hitW: 14, hitH: ps === 'lanes' ? 56 : 100, hitOffsetY: 0,
                isAerial: ps === 'jetpack'
            };
        } else {
            obs = {
                type: 'smart_drone', x: startX, y: ps === 'runner' ? groundY - 60 : baseY, lane: ev.lane,
                vx: 1.4, hitW: 42, hitH: 26, hitOffsetY: 6, isAerial: ps === 'jetpack'
            };
        }
        obstaclesList.push(obs);
    }

    function startDevilLevel(lvlId) {
        unlockAudio();
        updateViewportAndOrientation();
        gameMode = 'devil';
        activeRaceMeta = null;
        onlineRacers = [];
        selectedDevilLevelId = Math.max(1, Math.min(TOTAL_DEVIL_LEVELS, lvlId));
        selectedDevilChapter = DEVIL_LEVELS[selectedDevilLevelId - 1].chapterIndex;
        activeLevel = DEVIL_LEVELS[selectedDevilLevelId - 1];
        resetCommonRunState();
        buildDevilStageTraps(selectedDevilLevelId);
        updateHUD(true);
        addFloatingText(`😈 مقلب ${activeLevel.id} / 200 — احذر الفخاخ!`, V_WIDTH * 0.5, V_HEIGHT * 0.35, '#fb7185', 28);
    }

    function startEndlessMode() {
        unlockAudio();
        updateViewportAndOrientation();
        gameMode = 'endless';
        activeRaceMeta = null;
        onlineRacers = [];
        activeLevel = { ...LEVELS[Math.min(19, Math.max(0, (currentUser ? currentUser.progress.unlockedLevel : 1) - 1))], id: 0, name: 'الطور اللانهائي', icon: '♾️', levelLength: 999999999, targetCarrots: 999 };
        nextEndlessGemDist = 25000;
        resetCommonRunState();
        updateHUD(true);
        addFloatingText('♾️ انطلاق الطور اللانهائي!', V_WIDTH * 0.5, V_HEIGHT * 0.35, '#22d3ee', 28);
    }

    function startBossArena() {
        unlockAudio();
        updateViewportAndOrientation();
        gameMode = 'boss';
        activeRaceMeta = null;
        onlineRacers = [];
        activeLevel = { ...LEVELS[35], id: 0, name: 'ساحة الزعماء', icon: '🐉', levelLength: 999999999, targetCarrots: 50, speed: 7.4 };
        resetCommonRunState();
        spawnBoss(Math.floor(Math.random() * 3) + 1);
        updateHUD(true);
    }

    function launchOnlineRace() {
        if (!activeRaceRoom) return;
        const p = currentUser.progress;
        if (activeRaceRoom.mode === 'gems') {
            if (p.gems < 20) { showToast('رصيد الجواهر غير كافٍ'); activeRaceRoom = null; renderOnlineTab(); return; }
            p.gems -= 20;
            syncProgress();
        }
        unlockAudio();
        updateViewportAndOrientation();
        gameMode = 'online';
        activeRaceMeta = activeRaceRoom;
        activeRaceRoom = null;

        activeLevel = {
            ...LEVELS[21], id: 0,
            name: activeRaceMeta.mode === 'gems' ? 'بطولة الجواهر 💎' : 'السباق الأونلاين 🏎️',
            icon: '🏎️', levelLength: 7800, targetCarrots: 50, speed: 7.8, obstacleInterval: 78
        };

        onlineRacers = activeRaceMeta.roster.filter(r => !r.isMe).map((r, i) => ({
            username: r.username,
            char: BUNNY_CHARS.find(c => c.id === r.char) || BUNNY_CHARS[0],
            board: BOARDS_DATA.find(b => b.id === r.board) || BOARDS_DATA[0],
            isReal: Boolean(r.isReal),
            distance: 0,
            baseSpeed: 7.35 + (i * 0.32) + Math.random() * 0.45,
            emote: '',
            emoteTimer: 0,
            jumpY: 0,
            vy: 0
        }));

        trackQuest('races', 1);
        p.racesPlayed++;
        resetCommonRunState();
        updateHUD(true);
        addFloatingText('🏎️ انطلق السباق الأونلاين! 🏁', V_WIDTH * 0.5, V_HEIGHT * 0.35, '#22d3ee', 28);
    }

    // Cached HUD DOM elements
    const hudEls = {
        carrots: document.getElementById('hud-carrots'),
        bank: document.getElementById('hud-bank'),
        gems: document.getElementById('hud-gems'),
        lives: document.getElementById('hud-lives'),
        level: document.getElementById('hud-level'),
        fill: document.getElementById('hud-fill'),
        runner: document.getElementById('hud-runner'),
        racers: document.getElementById('hud-racers'),
        rankPill: document.getElementById('hud-rank-pill'),
        rank: document.getElementById('hud-rank'),
        bossHud: document.getElementById('boss-hud'),
        bossName: document.getElementById('boss-name'),
        bossFill: document.getElementById('boss-hp-fill'),
        bossText: document.getElementById('boss-hp-text'),
        emotes: document.getElementById('hud-emotes'),
        tcDash: document.getElementById('tc-dash'),
        tcUlt: document.getElementById('tc-ult'),
        tcUltPct: document.getElementById('tc-ult-pct'),
        hudUltBtn: document.getElementById('btn-hud-ult'),
        hudUltPct: document.getElementById('hud-ult-pct'),
        powerups: document.getElementById('hud-powerups'),
        pillCarrots: document.getElementById('pill-carrots')
    };
    const hudCache = { carrots: '', bank: -1, gems: -1, lives: '', level: '', pct: -1, cooldown: null, ultPct: -1, powerups: '', bumpTimer: 0 };

    function getMyRaceRank() {
        let rank = 1;
        onlineRacers.forEach(r => { if (r.distance > distance) rank++; });
        return rank;
    }

    function updateHUD(force = false) {
        const p = currentUser ? currentUser.progress : defaultProgress();

        const carrotsStr = gameMode === 'endless'
            ? `${Math.floor(distance / 25)}م • ${levelCarrots} 🥕`
            : gameMode === 'boss' || gameMode === 'online'
                ? `${levelCarrots} 🥕`
                : `${levelCarrots} / ${activeLevel.targetCarrots}`;
        if (force || hudCache.carrots !== carrotsStr) {
            hudCache.carrots = carrotsStr;
            if (hudEls.carrots) hudEls.carrots.textContent = carrotsStr;
        }
        if (force || hudCache.bank !== p.bankCarrots) {
            hudCache.bank = p.bankCarrots;
            if (hudEls.bank) hudEls.bank.textContent = p.bankCarrots;
        }
        if (force || hudCache.gems !== p.gems) {
            hudCache.gems = p.gems;
            if (hudEls.gems) hudEls.gems.textContent = p.gems;
        }

        const livesStr = '❤️'.repeat(Math.max(0, lives)) + (shieldActive ? '🛡️' : '') + (boardShieldReady ? '🛹' : '');
        if (force || hudCache.lives !== livesStr) {
            hudCache.lives = livesStr;
            if (hudEls.lives) hudEls.lives.textContent = livesStr || '0';
        }

        const levelStr = gameMode === 'endless' ? '♾️ لا نهائي' : gameMode === 'boss' ? '🐉 الزعيم' : gameMode === 'online' ? '🏎️ سباق' : gameMode === 'devil' ? `😈 مقلب ${activeLevel.id}` : `${activeLevel.icon} ليفل ${activeLevel.id}`;
        if (force || hudCache.level !== levelStr) {
            hudCache.level = levelStr;
            if (hudEls.level) hudEls.level.textContent = levelStr;
        }

        const pct = gameMode === 'endless' ? ((Math.floor(distance / 250)) % 100)
            : gameMode === 'boss' ? (bossEntity ? Math.max(0, 100 - bossEntity.hp) : 100)
                : Math.min(100, Math.round((distance / activeLevel.levelLength) * 200) / 2);

        if (force || hudCache.pct !== pct) {
            hudCache.pct = pct;
            const pctStr = `${pct}%`;
            if (hudEls.fill) hudEls.fill.style.width = pctStr;
            if (hudEls.runner) hudEls.runner.style.left = pctStr;
        }

        // Online HUD extras
        if (hudEls.rankPill) hudEls.rankPill.classList.toggle('hidden', gameMode !== 'online');
        if (hudEls.emotes) hudEls.emotes.classList.toggle('hidden', gameMode !== 'online');
        if (gameMode === 'online') {
            const rank = getMyRaceRank();
            const rMedals = ['🥇', '🥈', '🥉', '4️⃣'];
            if (hudEls.rank) hudEls.rank.textContent = `${rMedals[rank - 1]} ${rank}/${onlineRacers.length + 1}`;
            if (hudEls.racers) {
                hudEls.racers.innerHTML = onlineRacers.map(r => {
                    const rPct = Math.min(100, Math.round((r.distance / activeLevel.levelLength) * 100));
                    return `<span class="racer-dot" style="left:${rPct}%">${r.char.icon.slice(0, 2)}</span>`;
                }).join('');
            }
        } else if (hudEls.racers && hudEls.racers.innerHTML !== '') {
            hudEls.racers.innerHTML = '';
        }

        // Boss HUD
        if (hudEls.bossHud) {
            hudEls.bossHud.classList.toggle('hidden', !bossEntity);
            if (bossEntity) {
                hudEls.bossName.textContent = bossEntity.name;
                hudEls.bossFill.style.width = `${bossEntity.hp}%`;
                hudEls.bossText.textContent = `${bossEntity.hp}%`;
            }
        }

        const isCool = dashCooldown > 0;
        if (force || hudCache.cooldown !== isCool) {
            hudCache.cooldown = isCool;
            if (hudEls.tcDash) hudEls.tcDash.classList.toggle('cooldown', isCool);
        }

        const uPct = Math.floor(ultCharge);
        if (force || hudCache.ultPct !== uPct) {
            hudCache.ultPct = uPct;
            const ready = uPct >= 100;
            if (hudEls.tcUltPct) hudEls.tcUltPct.textContent = ready ? 'جاهز!' : `${uPct}%`;
            if (hudEls.hudUltPct) hudEls.hudUltPct.textContent = ready ? 'جاهز!' : `${uPct}%`;
            if (hudEls.tcUlt) hudEls.tcUlt.classList.toggle('ready', ready);
            if (hudEls.hudUltBtn) hudEls.hudUltBtn.classList.toggle('ready', ready);
        }

        let puHtml = '';
        if (feverTimer > 0) puHtml += `<span class="pu fever">🌈 حمى الجزر الذهبي (${Math.ceil(feverTimer / 60)}ث)</span>`;
        if (timeWarpTimer > 0) puHtml += `<span class="pu cyan">⏳ تباطؤ الزمن (${Math.ceil(timeWarpTimer / 60)}ث)</span>`;
        if (magnetTimer > 0) puHtml += `<span class="pu">🧲 مغناطيس (${Math.ceil(magnetTimer / 60)}ث)</span>`;
        if (shieldActive) puHtml += `<span class="pu">🛡️ درع الحماية</span>`;
        if (dashTimer > 0) puHtml += `<span class="pu cyan">⚡ اختراق نيترو!</span>`;
        if (force || hudCache.powerups !== puHtml) {
            hudCache.powerups = puHtml;
            if (hudEls.powerups) hudEls.powerups.innerHTML = puHtml;
        }

        if (hudCache.bumpTimer > 0) {
            hudCache.bumpTimer--;
            if (hudCache.bumpTimer === 0 && hudEls.pillCarrots) hudEls.pillCarrots.classList.remove('bump');
        }
    }

    // ==================== 10. SPAWNERS, BOSS, FEVER & COLLISION ====================
    function spawnCarrotWave() {
        if (finishCastle) return;
        const ps = getActivePlayStyle();
        const startX = V_WIDTH + 70;
        const roll = Math.random();
        const upg = currentUser ? (currentUser.progress.upgrades.doubleCarrot || 0) : 0;
        const pet = getActivePet();
        const doubleChance = 0.12 + upg * 0.18 + (pet.id === 'star_fairy' ? 0.25 : 0);

        const makeCarrot = (x, y, lane = null) => ({
            x, y, lane, radius: 24, bobOffset: Math.random() * Math.PI * 2,
            isGolden: feverTimer > 0 || Math.random() < doubleChance
        });

        if (ps === 'jetpack') {
            const skyB = getSkyBounds();
            const span = Math.max(140, skyB.maxY - skyB.minY - 50);
            const baseY = skyB.minY + 25 + Math.random() * span;
            for (let i = 0; i < 6; i++) {
                const waveY = Math.max(skyB.minY, Math.min(skyB.maxY - 12, baseY + Math.sin(i * 0.85) * 65));
                carrotsList.push(makeCarrot(startX + i * 54, waveY));
            }
            return;
        }

        if (ps === 'lanes') {
            const lane = Math.floor(Math.random() * 3);
            if (roll < 0.65) {
                for (let i = 0; i < 5; i++) {
                    carrotsList.push(makeCarrot(startX + i * 58, getLaneY(lane) - 32, lane));
                }
            } else {
                const dirs = [0, 1, 2, 1, 0];
                for (let i = 0; i < dirs.length; i++) {
                    const l = dirs[i];
                    carrotsList.push(makeCarrot(startX + i * 72, getLaneY(l) - 32, l));
                }
            }
            return;
        }

        if (roll < 0.45) {
            for (let i = 0; i < 5; i++) {
                const cx = startX + i * 58;
                const nearHazard = obstaclesList.some(o => Math.abs(o.x - cx) < 105 && !o.isAerial && o.type !== 'smart_drone')
                    || devilPitsList.some(dp => Math.abs(dp.x - cx) < 110);
                carrotsList.push(makeCarrot(cx, nearHazard ? groundY - 165 : groundY - 36));
            }
        } else if (roll < 0.82) {
            const arc = [82, 134, 156, 134, 82];
            for (let i = 0; i < arc.length; i++) carrotsList.push(makeCarrot(startX + i * 58, groundY - arc[i]));
        } else {
            const nearObs = obstaclesList.some(o => Math.abs(o.x - startX) < 250) || devilPitsList.some(dp => Math.abs(dp.x - startX) < 250);
            if (!nearObs && gameMode !== 'devil') {
                jumpPadsList.push({ x: startX, y: groundY, width: 50, height: 15 });
                for (let i = 0; i < 5; i++) carrotsList.push(makeCarrot(startX + 70 + i * 56, groundY - 195 - (i % 2) * 24));
            } else {
                const arc = [88, 140, 165, 140, 88];
                for (let i = 0; i < arc.length; i++) carrotsList.push(makeCarrot(startX + i * 58, groundY - arc[i]));
            }
        }
    }

    function spawnPowerupItem() {
        if (finishCastle) return;
        const ps = getActivePlayStyle();
        const types = ['magnet', 'shield', 'nitro'];
        const type = types[Math.floor(Math.random() * types.length)];
        if (ps === 'jetpack') {
            const skyB = getSkyBounds();
            powerupsList.push({ type, x: V_WIDTH + 80, y: skyB.minY + 20 + Math.random() * Math.max(140, skyB.maxY - skyB.minY - 50), radius: 25 });
        } else if (ps === 'lanes') {
            const l = Math.floor(Math.random() * 3);
            powerupsList.push({ type, x: V_WIDTH + 80, y: getLaneY(l) - 36, lane: l, radius: 25 });
        } else {
            powerupsList.push({ type, x: V_WIDTH + 80, y: groundY - 115 - Math.random() * 45, radius: 25 });
        }
    }

    function spawnSkyRingWave() {
        if (finishCastle || getActivePlayStyle() !== 'jetpack') return;
        const skyB = getSkyBounds();
        const y = skyB.minY + 25 + Math.random() * Math.max(140, skyB.maxY - skyB.minY - 55);
        skyRingsList.push({ x: V_WIDTH + 90, y, radius: 42 });
    }

    function spawnLaneGateWave() {
        if (finishCastle || getActivePlayStyle() !== 'lanes') return;
        const perks = [
            { kind: 'carrots', label: '+25 🥕', color: '#22c55e' },
            { kind: 'ult', label: '+35% 💥', color: '#22d3ee' },
            { kind: 'shield', label: '🛡️+🧲', color: '#eab308' }
        ];
        // Shuffle perks across the 3 lanes
        for (let i = perks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [perks[i], perks[j]] = [perks[j], perks[i]];
        }
        const waveId = frameCount + Math.random();
        for (let l = 0; l < 3; l++) {
            laneGatesList.push({
                x: V_WIDTH + 95,
                y: getLaneY(l) - 32,
                lane: l,
                waveId,
                ...perks[l]
            });
        }
    }

    function trySpawnCalibratedObstacle() {
        if (finishCastle || feverTimer > 0 || gameMode === 'devil') return;
        if (gameMode !== 'endless' && gameMode !== 'boss' && distance > activeLevel.levelLength - 680) return;

        const ps = getActivePlayStyle();
        const effSpeed = Math.max(worldSpeed || activeLevel.speed || 7, activeLevel.speed || 7);
        const minSafeGap = Math.max(300, activeLevel.obstacleInterval * effSpeed * (ps === 'jetpack' ? 0.62 : 0.78));
        const rightmostX = obstaclesList.reduce((max, o) => Math.max(max, o.x), 0);
        const startX = V_WIDTH + 80;

        if (rightmostX > 0 && startX - rightmostX < minSafeGap) return;

        if (ps === 'jetpack') {
            const airTypes = ['ufo', 'meteor', 'sky_drone'];
            const type = airTypes[Math.floor(Math.random() * airTypes.length)];
            const skyB = getSkyBounds();
            const yPos = skyB.minY + 10 + Math.random() * Math.max(140, skyB.maxY - skyB.minY - 25);
            obstaclesList.push({
                type, x: startX, y: yPos,
                vx: type === 'meteor' ? 2.4 : 1.4,
                hp: type === 'meteor' ? 2 : 1,
                hitW: 44, hitH: 38, hitOffsetY: -19, isAerial: true, rot: 0
            });
            return;
        }

        if (ps === 'lanes') {
            if (laneGatesList.some(g => Math.abs(g.x - startX) < 220)) return;
            const laneTypes = ['rock', 'cactus', 'fire', 'spike_roller', 'crystal_spike'];
            const blockedCount = Math.random() < 0.45 ? 2 : 1;
            const freeLane = Math.floor(Math.random() * 3);
            let placed = 0;
            for (let l = 0; l < 3; l++) {
                if (l === freeLane) continue;
                if (placed >= blockedCount) break;
                const type = laneTypes[Math.floor(Math.random() * laneTypes.length)];
                obstaclesList.push({
                    type, x: startX, y: getLaneY(l), lane: l,
                    vx: 0, hitW: 36, hitH: 38, hitOffsetY: 0, rot: 0
                });
                placed++;
            }
            return;
        }

        if (jumpPadsList.some(jp => Math.abs(jp.x - startX) < 240) || feverPortalsList.some(fp => Math.abs(fp.x - startX) < 220)) return;

        const types = activeLevel.obstacles;
        const type = types[Math.floor(Math.random() * types.length)];

        let obs = null;
        switch (type) {
            case 'rock': obs = { type, x: startX, y: groundY, vx: 0, hitW: 36, hitH: 36, hitOffsetY: 0 }; break;
            case 'log': obs = { type, x: startX, y: groundY, vx: 0, hitW: 40, hitH: 36, hitOffsetY: 0 }; break;
            case 'crystal_spike': obs = { type, x: startX, y: groundY, vx: 0, hitW: 32, hitH: 48, hitOffsetY: 0 }; break;
            case 'cactus': obs = { type, x: startX, y: groundY, vx: 0, hitW: 30, hitH: 54, hitOffsetY: 0 }; break;
            case 'ninja_fox': obs = { type, x: startX, y: groundY, vx: 2.0, vy: 0, jumped: false, hitW: 44, hitH: 32, hitOffsetY: 0 }; break;
            case 'fire': obs = { type, x: startX, y: groundY, vx: 0, hitW: 34, hitH: 44, hitOffsetY: 0 }; break;
            case 'spike_roller': obs = { type, x: startX, y: groundY, vx: 1.5, rot: 0, hitW: 38, hitH: 38, hitOffsetY: 0 }; break;
            case 'smart_drone': obs = { type, x: startX, y: groundY - 60, vx: 1.4, hitW: 42, hitH: 26, hitOffsetY: 6 }; break;
            case 'laser_gate': obs = { type, x: startX, y: groundY, vx: 0, cycle: Math.random() * 100, hitW: 14, hitH: 100, hitOffsetY: 0 }; break;
            default: obs = { type: 'rock', x: startX, y: groundY, vx: 0, hitW: 36, hitH: 36, hitOffsetY: 0 };
        }
        obstaclesList.push(obs);
        carrotsList.forEach(c => {
            if (Math.abs(c.x - startX) < 110 && c.y > groundY - 125) c.y = groundY - 165;
        });
    }

    function spawnJumpDust(x, y) {
        for (let i = 0; i < 5; i++) {
            if (particlesList.length >= 36) particlesList.shift();
            particlesList.push({ x: x + (Math.random() - 0.5) * 24, y: y - 4, vx: (Math.random() - 0.5) * 5 - 2, vy: -Math.random() * 4, size: 4 + Math.random() * 3, color: '#fde047', alpha: 1, decay: 0.065 });
        }
    }

    function spawnCarrotSparkles(x, y, isGold) {
        const colors = isGold ? ['#ffd700', '#fef08a', '#ffffff'] : ['#ff7b00', '#ffd700', '#4ade80'];
        for (let i = 0; i < 5; i++) {
            if (particlesList.length >= 36) particlesList.shift();
            const angle = (Math.PI * 2 * i) / 5 + Math.random() * 0.4;
            const spd = 2.5 + Math.random() * 4;
            particlesList.push({ x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, size: 4 + Math.random() * 3, color: colors[i % colors.length], alpha: 1, decay: 0.065 });
        }
    }

    function spawnConfettiBurst() {
        const colors = ['#f43f5e', '#ffd700', '#06b6d4', '#ff7b00', '#a855f7', '#10b981'];
        for (let i = 0; i < 52; i++) {
            confettiList.push({ x: V_WIDTH * 0.5 + (Math.random() - 0.5) * (V_WIDTH * 0.65), y: V_HEIGHT * 0.25 + (Math.random() - 0.5) * 80, vx: (Math.random() - 0.5) * 14, vy: -5 - Math.random() * 10, w: 8 + Math.random() * 7, h: 6 + Math.random() * 5, color: colors[i % colors.length], rot: Math.random() * Math.PI * 2, vRot: (Math.random() - 0.5) * 0.25, life: 100 + Math.random() * 35 });
        }
    }

    function addFloatingText(text, x, y, color = '#ffd700', size = 22) {
        if (floatingTexts.length >= 6) floatingTexts.shift();
        floatingTexts.push({ text, x, y, vy: -2.2, alpha: 1, color, size });
    }

    function rectIntersect(r1, r2) {
        return !(r2.x > r1.x + r1.width || r2.x + r2.width < r1.x || r2.y > r1.y + r1.height || r2.y + r2.height < r1.y);
    }

    function handlePlayerObstacleHit(sourceObj, listRef, idx) {
        const pyTop = player.getVisualY() - 110;
        if (dashTimer > 0 || feverTimer > 0) {
            spawnCarrotSparkles(sourceObj.x, sourceObj.y - 30, true);
            addFloatingText('تحطيم خارق! 💥', sourceObj.x, sourceObj.y - 70, '#38bdf8', 22);
            listRef.splice(idx, 1);
            return false;
        }
        if (invincibleFrames > 0) return false;

        if (boardShieldReady) {
            const bd = getActiveBoard();
            boardShieldReady = false;
            boardShieldCd = bd.shieldCd || 900;
            invincibleFrames = 70;
            sfxHit();
            addFloatingText('🛹 الزلاجة صدّت الصدمة!', player.x, pyTop, '#22d3ee', 23);
            listRef.splice(idx, 1);
            return false;
        }
        if (shieldActive) {
            shieldActive = false;
            invincibleFrames = 75;
            sfxHit();
            addFloatingText('🛡️ الدرع حماكي!', player.x, pyTop, '#ffd700', 24);
            listRef.splice(idx, 1);
            return false;
        }

        sfxHit();
        shakeFrames = 15;
        combo = 1;
        invincibleFrames = 80;

        if (gameMode === 'online') {
            slowTimer = 60;
            addFloatingText('تعثرتي! 💫', player.x, pyTop, '#f43f5e', 24);
            listRef.splice(idx, 1);
            return false;
        }

        lives--;
        addFloatingText('آخ! حاسبي 💥', player.x, pyTop, '#f43f5e', 24);
        if (lives <= 0) {
            const p = currentUser ? currentUser.progress : defaultProgress();
            if (!reviveUsedThisRun && p.gems >= 15) {
                openReviveModal();
                return true;
            }
            finishRun(false);
            return true;
        }
        return false;
    }

    function openReviveModal() {
        state = 'REVIVE';
        reviveUsedThisRun = true;
        let sec = 6;
        document.getElementById('revive-timer').textContent = sec;
        toggleOverlayModal('revive', true);
        if (reviveInterval) clearInterval(reviveInterval);
        reviveInterval = setInterval(() => {
            sec--;
            document.getElementById('revive-timer').textContent = Math.max(0, sec);
            if (sec <= 0) {
                clearInterval(reviveInterval);
                toggleOverlayModal('revive', false);
                finishRun(false);
            }
        }, 1000);
    }

    document.getElementById('btn-revive-gem').addEventListener('click', () => {
        if (reviveInterval) clearInterval(reviveInterval);
        const p = currentUser.progress;
        if (p.gems < 15) return;
        p.gems -= 15;
        lives = gameMode === 'devil' ? 1 : 2;
        invincibleFrames = 110;
        obstaclesList = [];
        devilPitsList = [];
        bossProjectiles = [];
        sfxPowerup();
        syncProgress();
        toggleOverlayModal('revive', false);
        state = 'PLAYING';
        showOnlyScreen(null);
        addFloatingText('💖 تم الإنعاش الفوري! 💎', player.x + 30, player.getVisualY() - 110, '#67e8f9', 26);
        updateHUD(true);
    });
    document.getElementById('btn-revive-skip').addEventListener('click', () => {
        if (reviveInterval) clearInterval(reviveInterval);
        toggleOverlayModal('revive', false);
        finishRun(false);
    });

    function updateGame() {
        if (isPortraitBlocked) return;
        frameCount++;

        const activePet = getActivePet();
        const activeBoard = getActiveBoard();
        const activeChar = getActiveChar();
        const theme = getActiveVisualTheme();
        const ps = getActivePlayStyle();

        if (shakeFrames > 0) shakeFrames--;
        if (invincibleFrames > 0) invincibleFrames--;
        if (magnetTimer > 0) magnetTimer--;
        if (timeWarpTimer > 0) timeWarpTimer--;
        if (feverTimer > 0) feverTimer--;
        if (slowTimer > 0) slowTimer--;
        if (playerEmoteTimer > 0) { playerEmoteTimer--; if (playerEmoteTimer === 0) playerEmote = ''; }

        if (activeBoard.id !== 'none' && !boardShieldReady) {
            boardShieldCd--;
            if (boardShieldCd <= 0) {
                boardShieldReady = true;
                addFloatingText('🛹 درع الزلاجة جاهز!', player.x, player.getVisualY() - 125, '#22d3ee', 19);
            }
        }

        if (comboTimer > 0) {
            comboTimer--;
            if (comboTimer === 0) combo = 1;
        }

        // Dynamic Speed Calculation
        const endlessBoost = gameMode === 'endless' ? Math.min(6.5, distance / 9000) : 0;
        const speedMult = dashTimer > 0 ? 2.1 : feverTimer > 0 ? 1.55 : slowTimer > 0 ? 0.48 : timeWarpTimer > 0 ? 0.65 : 1.0;
        const boardSpd = activeBoard.id === 'neon_board' ? 1.08 : activeBoard.id === 'galactic_surf' ? 1.1 : 1.0;
        worldSpeed = (activeLevel.speed + endlessBoost) * speedMult * boardSpd;
        distance += worldSpeed;

        // Endless milestone gems
        if (gameMode === 'endless' && distance >= nextEndlessGemDist) {
            nextEndlessGemDist += 25000;
            if (currentUser) {
                currentUser.progress.gems += 5;
                syncProgress();
            }
            sfxPowerup();
            addFloatingText('🎉 مسافة ألف متر! +5 💎', V_WIDTH * 0.5, V_HEIGHT * 0.3, '#67e8f9', 26);
        }

        // Story boss trigger on every 10th level
        if (gameMode === 'story' && activeLevel.isBossStage && !storyBossSpawned && !bossEntity && distance > activeLevel.levelLength * 0.45) {
            storyBossSpawned = true;
            spawnBoss(Math.floor(activeLevel.id / 10));
        }

        player.update();
        const pBox = player.getHitbox();
        const cBox = player.getCollectBox();

        // Jetpack Mode Auto-Lasers & Laser Hits
        if (ps === 'jetpack') {
            autoLaserTimer++;
            if (autoLaserTimer >= 26) {
                autoLaserTimer = 0;
                fireLaserBurst(1);
            }
        }
        for (let i = playerLasers.length - 1; i >= 0; i--) {
            const ls = playerLasers[i];
            ls.x += ls.vx;
            ls.y += ls.vy;
            ls.life--;
            let hit = false;

            if (bossEntity && Math.abs(ls.x - bossEntity.x) < 65 && Math.abs(ls.y - bossEntity.y) < 75) {
                damageBoss(3);
                hit = true;
            }
            if (!hit) {
                for (let j = obstaclesList.length - 1; j >= 0; j--) {
                    const o = obstaclesList[j];
                    const oCy = o.isAerial ? o.y : o.y - o.hitH / 2;
                    if (Math.abs(ls.x - o.x) < 36 && Math.abs(ls.y - oCy) < 36) {
                        o.hp = (o.hp || 1) - 1;
                        hit = true;
                        if (o.hp <= 0) {
                            spawnCarrotSparkles(o.x, oCy, true);
                            spawnShockwave(o.x, oCy, '#22d3ee', 65, 5.5);
                            addFloatingText('💥 +8 🥕', o.x, oCy - 20, '#38bdf8', 20);
                            levelCarrots += 8;
                            if (currentUser) { currentUser.progress.bankCarrots += 8; currentUser.progress.totalCarrots += 8; }
                            ultCharge = Math.min(100, ultCharge + 4);
                            obstaclesList.splice(j, 1);
                            playTone(480, 'triangle', 0.08, 0.1, 200);
                        }
                        break;
                    }
                }
            }
            if (hit || ls.life <= 0 || ls.x > V_WIDTH + 60) {
                playerLasers.splice(i, 1);
            }
        }

        // Pet Mini-Dragon auto-fireball
        if (activePet.id === 'mini_dragon') {
            petFireTimer++;
            if (petFireTimer >= 420 && obstaclesList.length > 0) {
                petFireTimer = 0;
                petFireballs.push({ x: player.x + 20, y: player.getVisualY() - 60, vx: 16 });
                playTone(500, 'sawtooth', 0.12, 0.12, 220);
            }
        }
        for (let i = petFireballs.length - 1; i >= 0; i--) {
            const fb = petFireballs[i];
            fb.x += fb.vx;
            let hit = false;
            for (let j = obstaclesList.length - 1; j >= 0; j--) {
                const o = obstaclesList[j];
                const oCy = o.isAerial ? o.y : o.y - o.hitH / 2;
                if (Math.abs(fb.x - o.x) < 42 && Math.abs(fb.y - oCy) < 65) {
                    spawnCarrotSparkles(o.x, oCy, true);
                    addFloatingText('🐉 كرة النار! +15 🥕', o.x, oCy - 35, '#f97316', 21);
                    levelCarrots += 15;
                    if (currentUser) { currentUser.progress.bankCarrots += 15; currentUser.progress.totalCarrots += 15; }
                    obstaclesList.splice(j, 1);
                    hit = true;
                    break;
                }
            }
            if (hit || fb.x > V_WIDTH + 60) petFireballs.splice(i, 1);
        }

        // Boss logic & Missiles
        if (bossEntity) {
            bossEntity.y = groundY - 150 + Math.sin(frameCount * 0.05) * 75;
            bossEntity.atkTimer--;
            if (bossEntity.atkTimer <= 0) {
                bossEntity.atkTimer = gameMode === 'boss' ? 85 : 120;
                if (ps === 'lanes') {
                    const bLane = Math.floor(Math.random() * 3);
                    bossProjectiles.push({ x: bossEntity.x - 45, y: getLaneY(bLane) - 24, lane: bLane, vx: worldSpeed + 4.5, radius: 16 });
                } else if (ps === 'jetpack') {
                    bossProjectiles.push({ x: bossEntity.x - 45, y: Math.max(155, player.y - 45), vx: worldSpeed + 4.8, radius: 16 });
                } else {
                    const aimY = Math.random() < 0.5 ? groundY - 26 : groundY - 82;
                    bossProjectiles.push({ x: bossEntity.x - 45, y: aimY, vx: worldSpeed + 4.5, radius: 16 });
                }
            }
            nextBossMissileTimer--;
            if (nextBossMissileTimer <= 0) {
                nextBossMissileTimer = 140;
                if (ps === 'lanes') {
                    const mLane = Math.floor(Math.random() * 3);
                    bossMissiles.push({ x: V_WIDTH + 40, y: getLaneY(mLane) - 30, lane: mLane, radius: 22 });
                } else {
                    const skyB = getSkyBounds();
                    bossMissiles.push({ x: V_WIDTH + 40, y: ps === 'jetpack' ? skyB.minY + 35 + Math.random() * Math.max(140, skyB.maxY - skyB.minY - 65) : groundY - 40 - Math.random() * 90, radius: 22 });
                }
            }
        }

        for (let i = bossProjectiles.length - 1; i >= 0; i--) {
            const bp = bossProjectiles[i];
            bp.x -= bp.vx;
            let hitProj = false;
            if (ps === 'lanes' && typeof bp.lane === 'number') {
                hitProj = (bp.lane === player.lane && Math.abs(player.hopY) <= 44 && Math.abs(bp.x - player.x) < 28);
            } else {
                const bBox = { x: bp.x - 12, y: bp.y - 12, width: 24, height: 24 };
                hitProj = rectIntersect(pBox, bBox);
            }
            if (hitProj) {
                if (handlePlayerObstacleHit(bp, bossProjectiles, i)) return;
                continue;
            }
            if (bp.x < -60) bossProjectiles.splice(i, 1);
        }

        for (let i = bossMissiles.length - 1; i >= 0; i--) {
            const bm = bossMissiles[i];
            bm.x -= worldSpeed;
            const mBox = { x: bm.x - 20, y: bm.y - 20, width: 40, height: 40 };
            const hitMissile = (ps === 'lanes' && typeof bm.lane === 'number')
                ? (bm.lane === player.lane && Math.abs(bm.x - player.x) < 42)
                : rectIntersect(cBox, mBox);
            if (hitMissile) {
                sfxPowerup();
                damageBoss(25);
                bossMissiles.splice(i, 1);
                continue;
            }
            if (bm.x < -60) bossMissiles.splice(i, 1);
        }

        // Sky Rings (Jetpack mode)
        nextSkyRingTimer--;
        if (ps === 'jetpack' && nextSkyRingTimer <= 0 && !finishCastle) {
            nextSkyRingTimer = 210 + Math.floor(Math.random() * 90);
            spawnSkyRingWave();
        }
        for (let i = skyRingsList.length - 1; i >= 0; i--) {
            const sr = skyRingsList[i];
            sr.x -= worldSpeed;
            const dx = sr.x - player.x;
            const dy = sr.y - (player.y - 50);
            if (dx * dx + dy * dy < 58 * 58) {
                sfxPowerup();
                levelCarrots += 15;
                if (currentUser) { currentUser.progress.bankCarrots += 15; currentUser.progress.totalCarrots += 15; }
                ultCharge = Math.min(100, ultCharge + 10);
                spawnCarrotSparkles(sr.x, sr.y, true);
                addFloatingText('⭕ حلقة طاقة! +15 🥕', sr.x, sr.y - 35, '#fde047', 22);
                skyRingsList.splice(i, 1);
                continue;
            }
            if (sr.x < -90) skyRingsList.splice(i, 1);
        }

        // Lane Tactical Gates (Lanes mode)
        nextLaneGateTimer--;
        if (ps === 'lanes' && nextLaneGateTimer <= 0 && !finishCastle) {
            nextLaneGateTimer = 330 + Math.floor(Math.random() * 140);
            spawnLaneGateWave();
        }
        for (let i = laneGatesList.length - 1; i >= 0; i--) {
            const g = laneGatesList[i];
            g.x -= worldSpeed;
            if (Math.abs(g.x - player.x) < 34 && g.lane === player.lane) {
                sfxPowerup();
                if (g.kind === 'carrots') {
                    levelCarrots += 25;
                    if (currentUser) { currentUser.progress.bankCarrots += 25; currentUser.progress.totalCarrots += 25; }
                    addFloatingText('🟢 بوابة الجزر! +25 🥕', g.x, g.y - 30, '#4ade80', 24);
                } else if (g.kind === 'ult') {
                    ultCharge = Math.min(100, ultCharge + 35);
                    addFloatingText('⚡ شحن خارق +35%!', g.x, g.y - 30, '#22d3ee', 24);
                } else {
                    shieldActive = true;
                    magnetTimer = Math.max(magnetTimer, 360);
                    addFloatingText('🛡️ بوابة الحماية والمغناطيس!', g.x, g.y - 30, '#fde047', 24);
                }
                spawnCarrotSparkles(g.x, g.y, true);
                const wid = g.waveId;
                laneGatesList = laneGatesList.filter(other => other.waveId !== wid);
                break;
            }
            if (g.x < -80) laneGatesList.splice(i, 1);
        }

        // Fever Portals
        nextFeverPortalTimer--;
        if (nextFeverPortalTimer <= 0 && !finishCastle && !bossEntity) {
            nextFeverPortalTimer = 950 + Math.floor(Math.random() * 400);
            const fLane = Math.floor(Math.random() * 3);
            const skyB = getSkyBounds();
            const fy = ps === 'lanes' ? getLaneY(fLane) - 36 : ps === 'jetpack' ? skyB.minY + 80 + Math.random() * Math.max(120, skyB.maxY - skyB.minY - 120) : groundY - 95;
            feverPortalsList.push({ x: V_WIDTH + 90, y: fy, radius: 42 });
        }
        for (let i = feverPortalsList.length - 1; i >= 0; i--) {
            const fp = feverPortalsList[i];
            fp.x -= worldSpeed;
            const nearX = Math.max(cBox.x, Math.min(fp.x, cBox.x + cBox.width));
            const nearY = Math.max(cBox.y, Math.min(fp.y, cBox.y + cBox.height));
            const dx = fp.x - nearX, dy = fp.y - nearY;
            if (dx * dx + dy * dy < 55 * 55) {
                feverTimer = 360;
                invincibleFrames = Math.max(invincibleFrames, 360);
                sfxUltimate();
                addFloatingText('🌈 وضع الحمى الذهبية! (x2 جزر!) 🔥', V_WIDTH * 0.5, V_HEIGHT * 0.34, '#fde047', 26);
                feverPortalsList.splice(i, 1);
                continue;
            }
            if (fp.x < -100) feverPortalsList.splice(i, 1);
        }

        // Finish Gate (Story, Devil & Online)
        if ((gameMode === 'story' || gameMode === 'devil' || gameMode === 'online') && !finishCastle && distance >= activeLevel.levelLength - V_WIDTH) {
            finishCastle = { x: V_WIDTH + 130, y: groundY, tricked: false };
            addFloatingText(gameMode === 'devil' ? '🚪 بوابة النجاة ظهرت!' : '🏰 خط النهاية ظهر! 🏁', V_WIDTH * 0.5, V_HEIGHT * 0.35, '#fde047', 26);
        }
        if (finishCastle) {
            finishCastle.x -= worldSpeed;
            if (gameMode === 'devil' && activeLevel.hasRunawayDoor && !finishCastle.tricked && finishCastle.x <= player.x + 215) {
                finishCastle.tricked = true;
                finishCastle.x += 320;
                sfxDash();
                spawnShockwave(finishCastle.x - 160, groundY - 80, '#fb7185', 110, 7);
                addFloatingText('هههه! الباب هرب! 😈🚪', player.x + 150, groundY - 150, '#fb7185', 26);
            }
            if (finishCastle.x <= player.x + 20) {
                finishRun(true);
                return;
            }
        }

        // Online Race Rivals Simulation & Sync
        if (gameMode === 'online') {
            onlineRacers.forEach(r => {
                if (!r.isReal) {
                    const rubber = Math.sin(frameCount * 0.03 + r.baseSpeed) * 0.8;
                    r.distance += r.baseSpeed + rubber;
                    if (Math.random() < 0.008 && r.jumpY === 0) r.vy = -12;
                    if (r.jumpY < 0 || r.vy < 0) {
                        r.jumpY += r.vy;
                        r.vy += 0.72;
                        if (r.jumpY >= 0) { r.jumpY = 0; r.vy = 0; }
                    }
                    if (Math.random() < 0.004 && r.emoteTimer <= 0) {
                        const ems = ['🔥', '⚡', '😂', '👑'];
                        r.emote = ems[Math.floor(Math.random() * ems.length)];
                        r.emoteTimer = 110;
                    }
                }
                if (r.emoteTimer > 0) r.emoteTimer--;
            });

            if (serverOnline && currentUser && currentUser.token && activeRaceMeta && activeRaceMeta.raceId.startsWith('race_')) {
                const now = performance.now();
                if (now - lastRaceSyncAt > 1600 || pendingEmoteToSend) {
                    lastRaceSyncAt = now;
                    const pct = Math.min(99.9, (distance / activeLevel.levelLength) * 100);
                    const em = pendingEmoteToSend;
                    pendingEmoteToSend = '';
                    apiCall('race_state', { token: currentUser.token, raceId: activeRaceMeta.raceId, pct, emote: em }).then(res => {
                        if (res.ok && Array.isArray(res.players)) {
                            res.players.forEach(sp => {
                                const r = onlineRacers.find(x => x.username.toLowerCase() === sp.username.toLowerCase());
                                if (r && r.isReal) {
                                    r.distance = (sp.pct / 100) * activeLevel.levelLength;
                                    if (sp.emote && (Date.now() / 1000 - (sp.emoteAt || 0)) < 4) {
                                        r.emote = sp.emote;
                                        r.emoteTimer = 90;
                                    }
                                }
                            });
                        }
                    }).catch(() => {});
                }
            }
        }

        // Standard & Level Devil Spawners
        nextCarrotTimer--;
        if (nextCarrotTimer <= 0) {
            spawnCarrotWave();
            nextCarrotTimer = feverTimer > 0 ? 22 : 44 + Math.floor(Math.random() * 32);
        }
        if (gameMode === 'devil') {
            while (devilScriptQueue.length > 0 && distance >= devilScriptQueue[0].spawnDist) {
                spawnDevilTrapEvent(devilScriptQueue.shift());
            }
        } else {
            trySpawnCalibratedObstacle();
        }
        nextPowerupTimer--;
        if (nextPowerupTimer <= 0 && gameMode !== 'devil') {
            spawnPowerupItem();
            nextPowerupTimer = 250 + Math.floor(Math.random() * 110);
        }

        // Level Devil Sink-Floor Pits
        for (let i = devilPitsList.length - 1; i >= 0; i--) {
            const pit = devilPitsList[i];
            pit.x -= worldSpeed;
            if (!pit.triggered && pit.x <= player.x + pit.triggerDist) {
                pit.triggered = true;
                playTone(185, 'sawtooth', 0.14, 0.14, 95);
                addFloatingText('⚠️ الأرض بتنهار!', pit.x, groundY - 88, '#fb7185', 20);
            }
            if (pit.triggered && pit.openProgress < 1) {
                pit.openProgress = Math.min(1, pit.openProgress + 0.14);
            }
            if (ps === 'runner' && pit.openProgress > 0.45 && !pit.passed) {
                const halfSafe = Math.max(18, pit.width / 2 - 12);
                if (player.x >= pit.x - halfSafe && player.x <= pit.x + halfSafe && player.y >= groundY - 8) {
                    if (dashTimer > 0 || feverTimer > 0 || invincibleFrames > 0) {
                        player.vy = -10.5;
                        pit.passed = true;
                    } else if (boardShieldReady) {
                        const bd = getActiveBoard();
                        boardShieldReady = false;
                        boardShieldCd = bd.shieldCd || 900;
                        invincibleFrames = 70;
                        player.vy = -13.5;
                        player.jumpsLeft = 1;
                        sfxHit();
                        addFloatingText('🛹 الزلاجة أنقذتك من الحفرة!', player.x, groundY - 110, '#22d3ee', 22);
                        pit.passed = true;
                    } else if (shieldActive) {
                        shieldActive = false;
                        invincibleFrames = 75;
                        player.vy = -13.5;
                        player.jumpsLeft = 1;
                        sfxHit();
                        addFloatingText('🛡️ الدرع أنقذك من الحفرة!', player.x, groundY - 110, '#ffd700', 22);
                        pit.passed = true;
                    } else {
                        sfxHit();
                        shakeFrames = 15;
                        combo = 1;
                        invincibleFrames = 80;
                        lives--;
                        addFloatingText('وقعت في الحفرة! 🕳️😈', player.x, groundY - 110, '#fb7185', 24);
                        if (lives <= 0) {
                            const p = currentUser ? currentUser.progress : defaultProgress();
                            if (!reviveUsedThisRun && p.gems >= 15) {
                                openReviveModal();
                                return;
                            }
                            finishRun(false);
                            return;
                        }
                        player.vy = -13.5;
                        pit.passed = true;
                    }
                } else if (player.x > pit.x + halfSafe + 6) {
                    pit.passed = true;
                }
            }
            if (pit.x < -160) devilPitsList.splice(i, 1);
        }

        // Jump Pads (Runner only)
        for (let i = jumpPadsList.length - 1; i >= 0; i--) {
            const jp = jumpPadsList[i];
            jp.x -= worldSpeed;
            if (ps === 'runner' && Math.abs(player.x - jp.x) < 38 && player.y >= groundY - 16 && player.vy >= 0) {
                player.vy = player.jumpForce * 1.35;
                player.jumpsLeft = 1;
                sfxPowerup();
                addFloatingText('قفزة زنبركية! 🚀', player.x, player.y - 90, '#4ade80', 22);
            }
            if (jp.x < -80) jumpPadsList.splice(i, 1);
        }

        // Powerups
        const pVisY = player.getVisualY();
        for (let i = powerupsList.length - 1; i >= 0; i--) {
            const pw = powerupsList[i];
            pw.x -= worldSpeed;
            const nearX = Math.max(cBox.x, Math.min(pw.x, cBox.x + cBox.width));
            const nearY = Math.max(cBox.y, Math.min(pw.y, cBox.y + cBox.height));
            const dx = pw.x - nearX, dy = pw.y - nearY;
            const lanePwHit = (ps === 'lanes' && typeof pw.lane === 'number')
                ? (pw.lane === player.lane && Math.abs(pw.x - player.x) < 48)
                : (dx * dx + dy * dy < (pw.radius + 18) * (pw.radius + 18));
            if (lanePwHit) {
                sfxPowerup();
                const upgMag = currentUser ? (currentUser.progress.upgrades.magnetDuration || 0) : 0;
                if (pw.type === 'magnet') {
                    magnetTimer = 420 + upgMag * 140;
                    addFloatingText('🧲 مغناطيس الجزر!', player.x, pVisY - 110, '#f43f5e', 24);
                } else if (pw.type === 'shield') {
                    shieldActive = true;
                    addFloatingText('🛡️ درع الحماية!', player.x, pVisY - 110, '#ffd700', 24);
                } else if (pw.type === 'nitro') {
                    dashCooldown = 0;
                    player.dash();
                }
                powerupsList.splice(i, 1);
                continue;
            }
            if (pw.x < -80) powerupsList.splice(i, 1);
        }

        // Carrots
        for (let i = carrotsList.length - 1; i >= 0; i--) {
            const c = carrotsList[i];
            c.x -= worldSpeed;

            const magPull = magnetTimer > 0 || (activePet.id === 'baby_fox' && Math.abs(c.x - player.x) < 220);
            if (magPull && c.x < V_WIDTH * 0.86 && c.x > player.x - 60) {
                c.x += (player.x - c.x) * (magnetTimer > 0 ? 0.19 : 0.08);
                c.y += (pVisY - 60 - c.y) * (magnetTimer > 0 ? 0.19 : 0.08);
                c.lane = null;
            }

            const nearestX = Math.max(cBox.x, Math.min(c.x, cBox.x + cBox.width));
            const nearestY = Math.max(cBox.y, Math.min(c.y, cBox.y + cBox.height));
            const dx = c.x - nearestX, dy = c.y - nearestY;

            const laneCollect = (ps === 'lanes' && typeof c.lane === 'number')
                ? (c.lane === player.lane && Math.abs(c.x - player.x) < 48 && Math.abs(player.hopY) <= 75)
                : (dx * dx + dy * dy < (c.radius + 16) * (c.radius + 16));

            if (laneCollect) {
                const petBonus = (activePet.id === 'star_fairy' ? 1 : activePet.id === 'golden_griffin' ? 2 : 0);
                const boardBonus = activeBoard.id === 'galactic_surf' ? 1 : 0;
                const baseGain = (c.isGolden ? 5 : 1) + (activeChar.bonusCarrots || 0) + petBonus + boardBonus;
                const feverMult = feverTimer > 0 ? 2 : 1;
                const gain = baseGain * (theme.bonusCarrotMult || 1) * feverMult;

                levelCarrots += gain;
                if (currentUser) {
                    currentUser.progress.bankCarrots += gain;
                    currentUser.progress.totalCarrots += gain;
                }
                trackQuest('carrots', 1);
                const chargeRate = activePet.id === 'cyber_owl' ? 6.5 : 4.5;
                ultCharge = Math.min(100, ultCharge + chargeRate);

                combo = Math.min(10, combo + 1);
                comboTimer = 150;
                sfxCarrot(combo);
                spawnCarrotSparkles(c.x, c.y, c.isGolden);
                addFloatingText(c.isGolden ? `+${gain} ذهبية! ✨` : `+${gain} 🥕`, c.x, c.y - 20, c.isGolden ? '#fde047' : '#ffb703', 21);

                if (hudEls.pillCarrots) {
                    if (hudCache.bumpTimer === 0) hudEls.pillCarrots.classList.add('bump');
                    hudCache.bumpTimer = 10;
                }
                carrotsList.splice(i, 1);
                continue;
            }
            if (c.x < -80) carrotsList.splice(i, 1);
        }

        // Obstacles
        for (let i = obstaclesList.length - 1; i >= 0; i--) {
            const o = obstaclesList[i];
            const oSpdFactor = timeWarpTimer > 0 ? 0.55 : 1;
            o.x -= (worldSpeed + (o.vx || 0)) * oSpdFactor;

            if (o.type === 'spike_roller' || o.type === 'meteor' || o.type === 'troll_saw') o.rot = (o.rot || 0) - (o.type === 'troll_saw' ? 0.26 : 0.16);
            else if (o.type === 'smart_drone') {
                const baseDroneY = (ps === 'lanes' && typeof o.lane === 'number') ? getLaneY(o.lane) - 24 : (o.isAerial ? o.y : groundY - 60);
                o.y = baseDroneY + Math.sin(frameCount * 0.08 + o.x * 0.01) * 4;
            } else if (o.type === 'sky_drone' || o.type === 'ufo') o.y += Math.sin(frameCount * 0.08 + o.x * 0.02) * 1.1;
            else if (o.type === 'ninja_fox') {
                if (!o.jumped && o.x < player.x + 240 && o.x > player.x + 150) { o.vy = -8.2; o.jumped = true; }
                if (o.jumped) {
                    o.y += o.vy; o.vy += 0.55;
                    if (o.y >= groundY) { o.y = groundY; o.vy = 0; }
                }
            } else if (o.type === 'laser_gate') o.cycle += 1;
            else if (o.type === 'hidden_spikes') {
                if (!o.triggered && o.x <= player.x + o.triggerDist) {
                    o.triggered = true;
                    playTone(620, 'square', 0.07, 0.11, 310);
                    addFloatingText('📌 فخ أشواك!', o.x, o.y - 72, '#fb7185', 19);
                }
                if (o.triggered && o.popProgress < 1) o.popProgress = Math.min(1, o.popProgress + 0.18);
            } else if (o.type === 'sliding_spike') {
                if (!o.triggered && o.x <= player.x + o.triggerDist) {
                    o.triggered = true;
                    o.vx = o.slideShift || -2.2;
                    playTone(340, 'triangle', 0.08, 0.12, 520);
                }
            } else if (o.type === 'falling_pillar') {
                if (!o.triggered && o.x <= player.x + o.triggerDist) {
                    o.triggered = true;
                    playTone(155, 'sawtooth', 0.11, 0.14, 70);
                }
                if (o.triggered && !o.isAerial && typeof o.targetY === 'number' && o.y < o.targetY) {
                    o.vy = (o.vy || 0) + 1.45;
                    o.y += o.vy;
                    if (o.y >= o.targetY) {
                        o.y = o.targetY;
                        o.vy = 0;
                        shakeFrames = Math.max(shakeFrames, 6);
                    }
                }
            } else if (o.type === 'troll_carrot') {
                if (!o.triggered && o.x <= player.x + o.triggerDist) {
                    o.triggered = true;
                    playTone(510, 'sawtooth', 0.09, 0.12, 240);
                    addFloatingText('مقلب 😈!', o.x, o.y - 62, '#fb7185', 20);
                }
            }
            if (o.type === 'troll_saw' && ps === 'runner' && !o.jumped && o.x < player.x + 215 && o.x > player.x + 125) {
                o.vy = -7.6;
                o.jumped = true;
            }
            if (o.type === 'troll_saw' && o.jumped && !o.isAerial) {
                o.y += o.vy;
                o.vy += 0.5;
                if (o.y >= groundY) { o.y = groundY; o.vy = 0; }
            }

            const isLaserOff = o.type === 'laser_gate' && (Math.floor(o.cycle) % 100 >= 46);
            const isDormantTrap = (o.type === 'hidden_spikes' && o.popProgress < 0.35)
                || (o.type === 'troll_carrot' && !o.triggered);
            let collided = false;
            if (!isLaserOff && !isDormantTrap) {
                if (ps === 'lanes' && typeof o.lane === 'number') {
                    collided = (o.lane === player.lane && Math.abs(player.hopY) <= 44 && Math.abs(o.x - player.x) < (o.hitW / 2 + 12));
                } else {
                    const padX = o.type === 'laser_gate' ? 2 : 5;
                    const padY = o.type === 'laser_gate' ? 4 : 5;
                    const oBox = o.isAerial
                        ? { x: o.x - o.hitW / 2 + padX, y: o.y - o.hitH / 2 + padY, width: Math.max(10, o.hitW - padX * 2), height: Math.max(10, o.hitH - padY * 2) }
                        : { x: o.x - o.hitW / 2 + padX, y: o.y - o.hitH - (o.hitOffsetY || 0) + padY, width: Math.max(10, o.hitW - padX * 2), height: Math.max(10, o.hitH - padY) };
                    collided = rectIntersect(pBox, oBox);
                }
            }

            if (collided) {
                if (handlePlayerObstacleHit(o, obstaclesList, i)) return;
            }
            if (o.x < -120) obstaclesList.splice(i, 1);
        }

        // Particles, Shockwaves & Texts
        for (let i = particlesList.length - 1; i >= 0; i--) {
            const pt = particlesList[i]; pt.x += pt.vx; pt.y += pt.vy; pt.alpha -= pt.decay;
            if (pt.alpha <= 0) particlesList.splice(i, 1);
        }
        for (let i = shockwavesList.length - 1; i >= 0; i--) {
            const sw = shockwavesList[i];
            sw.r += sw.speed;
            sw.alpha = Math.max(0, 1 - sw.r / sw.maxR);
            if (sw.r >= sw.maxR) shockwavesList.splice(i, 1);
        }
        for (let i = confettiList.length - 1; i >= 0; i--) {
            const cf = confettiList[i]; cf.x += cf.vx; cf.y += cf.vy; cf.vy += 0.26; cf.rot += cf.vRot; cf.life--;
            if (cf.life <= 0) confettiList.splice(i, 1);
        }
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            const ft = floatingTexts[i]; ft.y += ft.vy; ft.alpha -= 0.022;
            if (ft.alpha <= 0) floatingTexts.splice(i, 1);
        }

        updateHUD();
    }

    function completeBossArenaVictory() {
        finishRun(true);
    }

    function finishRun(won) {
        state = 'RESULT';
        stopBGM();
        const p = currentUser ? currentUser.progress : defaultProgress();
        const pet = getActivePet();
        const btnNext = document.getElementById('btn-next');

        if (gameMode === 'online') {
            const rank = getMyRaceRank();
            const isWin = rank === 1;
            const trophiesGain = rank === 1 ? (activeRaceMeta.mode === 'gems' ? 40 : 25) : rank === 2 ? 12 : rank === 3 ? 5 : 2;
            const gemsGain = activeRaceMeta.mode === 'gems'
                ? (rank === 1 ? 65 : rank === 2 ? 25 : 5)
                : (rank === 1 ? 15 : rank === 2 ? 8 : 2);
            const carrotsGain = rank === 1 ? (activeRaceMeta.mode === 'gems' ? 1000 : 400) : 150;

            p.trophies += trophiesGain;
            p.gems += gemsGain;
            p.bankCarrots += carrotsGain;
            p.totalCarrots += carrotsGain;
            p.xp += 120;
            if (isWin) p.racesWon++;
            if (serverOnline && currentUser && currentUser.token && activeRaceMeta && activeRaceMeta.raceId.startsWith('race_')) {
                apiCall('race_finish', { token: currentUser.token, raceId: activeRaceMeta.raceId, rank }).catch(() => {});
            }
            syncProgress();
            if (isWin) { playWinSound(); spawnConfettiBurst(); } else { playPowerupSafe(); }

            const medals = ['🥇 المركز الأول! بطل السباق!', '🥈 المركز الثاني!', '🥉 المركز الثالث!', '4️⃣ المركز الرابع'];
            document.getElementById('result-stars').textContent = medals[rank - 1];
            document.getElementById('result-title').textContent = isWin ? 'مبروك الفوز في السباق الأونلاين! 🏆' : 'انتهى السباق الأونلاين! 🏎️';
            document.getElementById('result-stats').innerHTML = `
                <div>الجوائز: <b>+${trophiesGain} 🏆</b> • <b style="color:#67e8f9">+${gemsGain} 💎</b> • <b>+${carrotsGain} 🥕</b></div>
                <div>إجمالي كؤوسك: <b>${p.trophies} 🏆</b> • جواهرك: <b style="color:#67e8f9">${p.gems} 💎</b></div>
            `;
            btnNext.classList.add('hidden');
        } else if (gameMode === 'endless') {
            const meters = Math.floor(distance / 25);
            const isNewRecord = meters > p.endlessHighScore;
            if (isNewRecord) p.endlessHighScore = meters;
            const bonusGems = Math.floor(meters / 500) * 5;
            p.gems += bonusGems;
            p.xp += Math.min(300, Math.floor(meters / 20));
            syncProgress();
            if (isNewRecord) { playWinSound(); spawnConfettiBurst(); } else { playLoseSound(); }

            document.getElementById('result-stars').textContent = isNewRecord ? '🏆 رقم قياسي جديد!' : '♾️ الطور اللانهائي';
            document.getElementById('result-title').textContent = `قطعتي مسافة ${meters} متر!`;
            document.getElementById('result-stats').innerHTML = `
                <div>أعلى رقم مسجل: <b>${p.endlessHighScore} متر</b></div>
                <div>جمعتي <b>${levelCarrots} 🥕</b> ${bonusGems > 0 ? `+ <b style="color:#67e8f9">${bonusGems} 💎</b>` : ''}</div>
            `;
            btnNext.classList.add('hidden');
        } else if (gameMode === 'boss') {
            if (won) {
                playWinSound(); spawnConfettiBurst();
                p.gems += 30; p.bankCarrots += 400; p.totalCarrots += 400; p.xp += 180;
                syncProgress();
                document.getElementById('result-stars').textContent = '🐉💥👑';
                document.getElementById('result-title').textContent = 'انتصار ساحق على الزعيم!';
                document.getElementById('result-stats').innerHTML = `
                    <div>المكافأة: <b style="color:#67e8f9">+30 💎</b> + <b>+400 🥕</b> + <b>180 XP</b></div>
                    <div>رصيدك: <b>${p.bankCarrots} 🥕</b> • <b style="color:#67e8f9">${p.gems} 💎</b></div>
                `;
            } else {
                playLoseSound(); syncProgress();
                document.getElementById('result-stars').textContent = '🐉💔';
                document.getElementById('result-title').textContent = 'الزعيم هزمك المرة دي!';
                document.getElementById('result-stats').innerHTML = `<div>حفظنا <b>${levelCarrots} 🥕</b> في البنك!</div>`;
            }
            btnNext.classList.add('hidden');
        } else if (gameMode === 'devil') {
            if (!p.devilStars || typeof p.devilStars !== 'object') p.devilStars = {};
            if (won) {
                playWinSound(); spawnConfettiBurst();
                let stars = 1;
                if (levelCarrots >= activeLevel.targetCarrots * 0.55) stars = 2;
                if (levelCarrots >= activeLevel.targetCarrots) stars = 3;

                if (stars > (p.devilStars[activeLevel.id] || 0)) p.devilStars[activeLevel.id] = stars;
                if (activeLevel.id >= (p.devilUnlockedLevel || 1) && activeLevel.id < TOTAL_DEVIL_LEVELS) {
                    p.devilUnlockedLevel = activeLevel.id + 1;
                }

                const milestoneBonus = activeLevel.id % 10 === 0 ? 15 : 0;
                const winGems = (stars === 3 ? 6 : 3) + milestoneBonus + (pet.id === 'golden_griffin' ? 3 : 0);
                p.gems += winGems;
                p.xp += 70 + stars * 25;
                trackQuest('levels', 1);
                syncProgress();

                document.getElementById('result-stars').textContent = '😈 ' + '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
                document.getElementById('result-title').textContent = `نجوت من المقلب ${activeLevel.id} / 200! 🏆`;
                document.getElementById('result-stats').innerHTML = `
                    <div>جمعتي <b>${levelCarrots} 🥕</b> + مكافأة الشجاعة <b style="color:#67e8f9">+${winGems} 💎</b> ${milestoneBonus ? '(+15 محطة عشرية!)' : ''}</div>
                    <div>تقدم طور المقالب: <b>${p.devilUnlockedLevel} / 200</b> • جواهرك: <b style="color:#67e8f9">${p.gems} 💎</b></div>
                `;
                btnNext.classList.toggle('hidden', activeLevel.id >= TOTAL_DEVIL_LEVELS);
                btnNext.textContent = `المقلب التالي (${activeLevel.id + 1}) 😈`;
            } else {
                playLoseSound();
                p.devilDeaths = (p.devilDeaths || 0) + 1;
                syncProgress();
                const pct = Math.min(99, Math.floor((distance / activeLevel.levelLength) * 100));
                document.getElementById('result-stars').textContent = '😈💀🕳️';
                document.getElementById('result-title').textContent = 'وقعت في المقلب يا أرنوب! 😈';
                document.getElementById('result-stats').innerHTML = `
                    <div>وصلت لـ <b>${pct}%</b> من المقلب ${activeLevel.id} • إجمالي السقطات: <b style="color:#fb7185">${p.devilDeaths} 💀</b></div>
                    <div>حفظنا <b>${levelCarrots} 🥕</b> في البنك (الإجمالي: <b>${p.bankCarrots} 🥕</b>)</div>
                `;
                btnNext.classList.add('hidden');
            }
        } else {
            // Story Mode
            if (won) {
                playWinSound(); spawnConfettiBurst();
                let stars = 1;
                if (levelCarrots >= activeLevel.targetCarrots * 0.7) stars = 2;
                if (levelCarrots >= activeLevel.targetCarrots) stars = 3;

                if (stars > (p.levelStars[activeLevel.id] || 0)) p.levelStars[activeLevel.id] = stars;
                if (activeLevel.id >= p.unlockedLevel && activeLevel.id < TOTAL_LEVELS) p.unlockedLevel = activeLevel.id + 1;

                const winGems = (stars === 3 ? 5 : 2) + (pet.id === 'golden_griffin' ? 3 : 0);
                p.gems += winGems;
                p.xp += 60 + stars * 20;
                trackQuest('levels', 1);
                syncProgress();

                document.getElementById('result-stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
                document.getElementById('result-title').textContent = `مبروك! كسبتي الليفل ${activeLevel.id} 🏁`;
                document.getElementById('result-stats').innerHTML = `
                    <div>جمعتي <b>${levelCarrots} 🥕</b> + هدية فوز <b style="color:#67e8f9">+${winGems} 💎</b></div>
                    <div>البنك: <b>${p.bankCarrots} 🥕</b> • الجواهر: <b style="color:#67e8f9">${p.gems} 💎</b></div>
                `;
                btnNext.classList.toggle('hidden', activeLevel.id >= TOTAL_LEVELS);
                btnNext.textContent = `الليفل التالي (${activeLevel.id + 1}) 🚀`;
            } else {
                playLoseSound();
                syncProgress();
                const pct = Math.min(99, Math.floor((distance / activeLevel.levelLength) * 100));
                document.getElementById('result-stars').textContent = '💔🐰🎀';
                document.getElementById('result-title').textContent = 'حاول تاني يا أرنوبة يا دلوعة! 🐰🎀';
                document.getElementById('result-stats').innerHTML = `
                    <div>قطعتي <b>${pct}%</b> من طريق الليفل ${activeLevel.id} 🏁</div>
                    <div>تم حفظ <b>${levelCarrots}</b> جزرة في البنك (الإجمالي: <b>${p.bankCarrots} 🥕</b>)</div>
                `;
                btnNext.classList.add('hidden');
            }
        }
        showOnlyScreen('result');
    }

    function playPowerupSafe() { sfxPowerup(); }

    // ==================== 11. 5D RENDER ENGINE ====================
    function drawBackground() {
        const theme = getActiveVisualTheme();
        const ps = getActivePlayStyle();
        const visualDist = state === 'PLAYING' ? distance : frameCount * 2.2;
        const skyBottomEdge = ps === 'lanes' ? groundY - 108 : groundY;
        const skyGrad = ctx.createLinearGradient(0, 0, 0, skyBottomEdge);
        skyGrad.addColorStop(0, feverTimer > 0 ? '#4c1d95' : theme.skyTop);
        skyGrad.addColorStop(1, feverTimer > 0 ? '#eab308' : theme.skyBottom);
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, V_WIDTH, skyBottomEdge);

        // Layer 1A: 5D Aurora / Nebula Light Waves
        ctx.save();
        for (let wave = 0; wave < 2; wave++) {
            const wGrad = ctx.createLinearGradient(0, 0, V_WIDTH, skyBottomEdge * 0.65);
            wGrad.addColorStop(0, wave === 0 ? 'rgba(34, 211, 238, 0.08)' : 'rgba(168, 85, 247, 0.08)');
            wGrad.addColorStop(0.5, wave === 0 ? 'rgba(168, 85, 247, 0.14)' : 'rgba(251, 191, 36, 0.1)');
            wGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = wGrad;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            for (let x = 0; x <= V_WIDTH + 60; x += 60) {
                const ay = skyBottomEdge * (0.28 + wave * 0.14) + Math.sin(x * 0.004 + frameCount * 0.018 + wave * 2) * 34;
                ctx.lineTo(x, ay);
            }
            ctx.lineTo(V_WIDTH, 0);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();

        // Dynamic lightning flash in storm weather
        if (theme.weather === 'storm' && Math.random() < 0.005) lightningFlash = 0.7;
        if (lightningFlash > 0) {
            ctx.fillStyle = `rgba(255,255,255,${lightningFlash * 0.45})`;
            ctx.fillRect(0, 0, V_WIDTH, skyBottomEdge);
            lightningFlash -= 0.08;
        }

        // Shooting stars (always active in jetpack high-altitude or dark weather)
        if ((ps === 'jetpack' || theme.weather === 'stars' || theme.weather === 'storm') && Math.random() < 0.018) {
            shootingStars.push({ x: V_WIDTH * (0.4 + Math.random() * 0.6), y: 20 + Math.random() * 140, vx: -14, vy: 5, life: 28 });
        }
        for (let i = shootingStars.length - 1; i >= 0; i--) {
            const ss = shootingStars[i];
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(ss.x, ss.y);
            ctx.lineTo(ss.x + 28, ss.y - 10);
            ctx.stroke();
            ss.x += ss.vx; ss.y += ss.vy; ss.life--;
            if (ss.life <= 0) shootingStars.splice(i, 1);
        }

        // Layer 1B: Volumetric Rotating God-Rays & Sun/Moon Halo
        ctx.save();
        const sunX = V_WIDTH * 0.8, sunY = skyBottomEdge * 0.24;
        ctx.translate(sunX, sunY);
        ctx.rotate(frameCount * 0.0025);
        for (let r = 0; r < 8; r++) {
            ctx.rotate(Math.PI / 4);
            const rayGrad = ctx.createLinearGradient(0, 0, 260, 0);
            rayGrad.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
            rayGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = rayGrad;
            ctx.beginPath();
            ctx.moveTo(0, -14);
            ctx.lineTo(260, -48);
            ctx.lineTo(260, 48);
            ctx.lineTo(0, 14);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();

        ctx.save();
        const outerHalo = ctx.createRadialGradient(sunX, sunY, 16, sunX, sunY, 140);
        outerHalo.addColorStop(0, theme.sunColor || '#fde047');
        outerHalo.addColorStop(0.35, 'rgba(253, 224, 71, 0.35)');
        outerHalo.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = outerHalo;
        ctx.beginPath(); ctx.arc(sunX, sunY, 140, 0, Math.PI * 2); ctx.fill();

        const sunCore = ctx.createRadialGradient(sunX - 8, sunY - 8, 4, sunX, sunY, 44);
        sunCore.addColorStop(0, '#ffffff');
        sunCore.addColorStop(0.65, theme.sunColor || '#fde047');
        sunCore.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sunCore;
        ctx.beginPath(); ctx.arc(sunX, sunY, 44, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        // Weather particles
        ctx.save();
        weatherParticles.forEach(wp => {
            wp.x += wp.vx;
            wp.y += wp.vy + Math.sin(frameCount * 0.04 + wp.phase) * 0.4;
            if (wp.x < 0) wp.x = V_WIDTH;
            if (wp.y < 0) wp.y = skyBottomEdge - 10;
            if (wp.y > skyBottomEdge) wp.y = 10;
            ctx.fillStyle = theme.weather === 'fireflies' ? 'rgba(253, 224, 71, 0.78)'
                : theme.weather === 'embers' ? 'rgba(251, 146, 60, 0.85)'
                : theme.weather === 'sakura' ? 'rgba(244, 114, 182, 0.85)'
                : 'rgba(255, 255, 255, 0.65)';
            ctx.beginPath();
            ctx.arc(wp.x, wp.y, wp.size, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();

        // Layer 2 & 3: 3D Shaded Parallax Mountains + Atmospheric Fog
        const hill1Grad = ctx.createLinearGradient(0, skyBottomEdge - 120, 0, skyBottomEdge);
        hill1Grad.addColorStop(0, theme.hillColor1);
        hill1Grad.addColorStop(1, '#020617');
        ctx.fillStyle = hill1Grad;
        ctx.beginPath();
        ctx.moveTo(0, skyBottomEdge);
        for (let x = 0; x <= V_WIDTH + 40; x += 36) {
            const ridge = Math.sin((x + visualDist * 0.15) * 0.0045) * 46 + Math.cos((x + visualDist * 0.08) * 0.011) * 14 + 68;
            ctx.lineTo(x, skyBottomEdge - ridge);
        }
        ctx.lineTo(V_WIDTH, skyBottomEdge); ctx.closePath(); ctx.fill();

        const hill2Grad = ctx.createLinearGradient(0, skyBottomEdge - 78, 0, skyBottomEdge);
        hill2Grad.addColorStop(0, theme.hillColor2);
        hill2Grad.addColorStop(1, '#050812');
        ctx.fillStyle = hill2Grad;
        ctx.beginPath();
        ctx.moveTo(0, skyBottomEdge);
        for (let x = 0; x <= V_WIDTH + 40; x += 36) {
            const ridge2 = Math.cos((x + visualDist * 0.35) * 0.007) * 30 + 38;
            ctx.lineTo(x, skyBottomEdge - ridge2);
        }
        ctx.lineTo(V_WIDTH, skyBottomEdge); ctx.closePath(); ctx.fill();

        // Atmospheric mist along the horizon for 5D depth separation
        const mistGrad = ctx.createLinearGradient(0, skyBottomEdge - 48, 0, skyBottomEdge);
        mistGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        mistGrad.addColorStop(1, 'rgba(103, 232, 249, 0.13)');
        ctx.fillStyle = mistGrad;
        ctx.fillRect(0, skyBottomEdge - 48, V_WIDTH, 48);

        // Layer 4: 3D Shaded Parallax Trees
        bgTreesList.forEach(tr => {
            if (!isPortraitBlocked) {
                tr.x -= state === 'PLAYING' ? worldSpeed * 0.42 : 1.1;
                if (tr.x < -100) tr.x = V_WIDTH + 80 + Math.random() * 100;
            }
            const s = tr.scale;
            ctx.fillStyle = 'rgba(0,0,0,0.28)';
            ctx.beginPath(); ctx.ellipse(tr.x, skyBottomEdge - 2, 18 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();

            ctx.fillStyle = theme.treeTrunk || '#3f2e21';
            ctx.fillRect(tr.x - 6 * s, skyBottomEdge - 42 * s, 12 * s, 42 * s);

            const crownColor = theme.treeCrown || theme.groundColor;
            const cGrad = ctx.createRadialGradient(tr.x - 8 * s, skyBottomEdge - 64 * s, 4 * s, tr.x, skyBottomEdge - 54 * s, 28 * s);
            cGrad.addColorStop(0, '#ffffff55');
            cGrad.addColorStop(0.35, crownColor);
            cGrad.addColorStop(1, '#020617aa');
            ctx.fillStyle = crownColor;
            ctx.beginPath(); ctx.arc(tr.x, skyBottomEdge - 54 * s, 25 * s, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = cGrad;
            ctx.beginPath(); ctx.arc(tr.x, skyBottomEdge - 54 * s, 25 * s, 0, Math.PI * 2); ctx.fill();
        });

        // Layer 5: 3D Perspective Road / Highway
        if (ps === 'lanes') {
            ctx.fillStyle = theme.groundColor;
            ctx.fillRect(0, skyBottomEdge - 6, V_WIDTH, 14);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(0, skyBottomEdge - 6, V_WIDTH, 3);

            const highwayTop = skyBottomEdge + 8;
            const hwGrad = ctx.createLinearGradient(0, highwayTop, 0, V_HEIGHT);
            hwGrad.addColorStop(0, '#0f172a');
            hwGrad.addColorStop(0.5, theme.roadColor);
            hwGrad.addColorStop(1, '#030612');
            ctx.fillStyle = hwGrad;
            ctx.fillRect(0, highwayTop, V_WIDTH, V_HEIGHT - highwayTop);

            // Perspective diagonal floor beams for 5D speed feel
            ctx.strokeStyle = 'rgba(103, 232, 249, 0.08)';
            ctx.lineWidth = 2;
            const gridOff = visualDist % 110;
            for (let x = -gridOff; x < V_WIDTH + 120; x += 110) {
                ctx.beginPath(); ctx.moveTo(x + 28, highwayTop); ctx.lineTo(x - 36, V_HEIGHT); ctx.stroke();
            }

            // Highlight active player lane with vertical gradient glow
            const laneTops = [highwayTop, groundY - 52, groundY + 10];
            const laneH = 60;
            const activeLGrad = ctx.createLinearGradient(0, laneTops[player.lane], 0, laneTops[player.lane] + laneH);
            activeLGrad.addColorStop(0, 'rgba(34, 211, 238, 0.04)');
            activeLGrad.addColorStop(0.5, 'rgba(34, 211, 238, 0.16)');
            activeLGrad.addColorStop(1, 'rgba(34, 211, 238, 0.04)');
            ctx.fillStyle = activeLGrad;
            ctx.fillRect(0, laneTops[player.lane], V_WIDTH, laneH);

            // Lane dividers & scrolling speed chevrons
            const offset = visualDist % 110;
            for (let l = 0; l < 3; l++) {
                const ly = getLaneY(l) - 18;
                ctx.fillStyle = l === player.lane ? 'rgba(34, 211, 238, 0.34)' : 'rgba(255, 255, 255, 0.1)';
                for (let x = -offset; x < V_WIDTH; x += 110) {
                    ctx.fillRect(x, ly, 44, 4);
                }
            }
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([28, 22]);
            ctx.lineDashOffset = visualDist % 50;
            [groundY - 52, groundY + 10].forEach(divY => {
                ctx.beginPath(); ctx.moveTo(0, divY); ctx.lineTo(V_WIDTH, divY); ctx.stroke();
            });
            ctx.setLineDash([]);

            // Lane labels on right/left marker
            ctx.save();
            ctx.font = "900 13px 'Cairo', sans-serif";
            ctx.textAlign = 'center';
            for (let l = 0; l < 3; l++) {
                ctx.fillStyle = l === player.lane ? '#67e8f9' : 'rgba(203,213,225,0.45)';
                ctx.fillText(`مسار ${l + 1}`, 42, getLaneY(l) - 10);
            }
            ctx.restore();
        } else {
            if (ps === 'jetpack') {
                ctx.save();
                ctx.strokeStyle = 'rgba(103, 232, 249, 0.2)';
                ctx.lineWidth = 2;
                const sOff = (visualDist * 1.45) % 160;
                for (let row = 0; row < 4; row++) {
                    const ry = 135 + row * 95;
                    for (let x = -sOff + row * 40; x < V_WIDTH; x += 160) {
                        ctx.beginPath(); ctx.moveTo(x, ry); ctx.lineTo(x + 56, ry); ctx.stroke();
                    }
                }
                ctx.restore();
            }

            // 3D Bevelled Verge & Neon Curb Strip
            ctx.fillStyle = theme.groundColor;
            ctx.fillRect(0, groundY - 10, V_WIDTH, 22);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
            ctx.fillRect(0, groundY - 10, V_WIDTH, 4);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.fillRect(0, groundY + 7, V_WIDTH, 5);

            const roadGrad = ctx.createLinearGradient(0, groundY + 12, 0, V_HEIGHT);
            roadGrad.addColorStop(0, theme.roadColor);
            roadGrad.addColorStop(0.45, '#090f20');
            roadGrad.addColorStop(1, '#02040a');
            ctx.fillStyle = roadGrad;
            ctx.fillRect(0, groundY + 12, V_WIDTH, V_HEIGHT - groundY + 20);

            // 3D Perspective slanted road depth beams
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 2;
            const pOffset = visualDist % 100;
            for (let x = -pOffset; x < V_WIDTH + 100; x += 100) {
                ctx.beginPath();
                ctx.moveTo(x, groundY + 12);
                ctx.lineTo(x - 42, V_HEIGHT);
                ctx.stroke();
            }

            // Glowing road center dashes
            ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
            const offset = visualDist % 90;
            for (let x = -offset; x < V_WIDTH; x += 90) ctx.fillRect(x, groundY + 34, 44, 5);

            // Ambient glowing neon horizon rail
            ctx.fillStyle = gameMode === 'devil' ? 'rgba(251, 113, 133, 0.55)' : 'rgba(34, 211, 238, 0.35)';
            ctx.fillRect(0, groundY + 12, V_WIDTH, 2);

            // Level Devil Sink-Floor Pits / Chasms
            devilPitsList.forEach(pit => {
                if (pit.x < -140 || pit.x > V_WIDTH + 140) return;
                ctx.save();
                const pw = pit.width;
                const px = pit.x - pw / 2;
                if (pit.openProgress <= 0.05) {
                    // Subtle warning fracture on dormant trap tile
                    ctx.strokeStyle = 'rgba(251, 113, 133, 0.72)';
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.moveTo(px + 8, groundY - 4);
                    ctx.lineTo(px + pw * 0.45, groundY + 4);
                    ctx.lineTo(px + pw - 8, groundY - 3);
                    ctx.stroke();
                } else {
                    const drop = pit.openProgress * 92;
                    const gapW = pw * (0.45 + 0.55 * pit.openProgress);
                    const gx = pit.x - gapW / 2;
                    // Abyss void
                    const voidGrad = ctx.createLinearGradient(0, groundY - 10, 0, V_HEIGHT);
                    voidGrad.addColorStop(0, '#090206');
                    voidGrad.addColorStop(0.65, '#450a0a');
                    voidGrad.addColorStop(1, '#ef4444');
                    ctx.fillStyle = voidGrad;
                    ctx.fillRect(gx, groundY - 10, gapW, V_HEIGHT - groundY + 25);
                    // Glowing crimson chasm edges
                    ctx.fillStyle = '#fb7185';
                    ctx.fillRect(gx - 3, groundY - 10, 4, 26);
                    ctx.fillRect(gx + gapW - 1, groundY - 10, 4, 26);
                    // Falling floor slab
                    ctx.globalAlpha = Math.max(0, 1 - pit.openProgress * 0.75);
                    ctx.fillStyle = theme.groundColor;
                    ctx.fillRect(gx + 3, groundY - 10 + drop, gapW - 6, 18);
                }
                ctx.restore();
            });
        }
    }

    function drawFinishCastle() {
        if (!finishCastle) return;
        ctx.save();
        ctx.translate(finishCastle.x, finishCastle.y);
        const isDevil = gameMode === 'devil';
        ctx.fillStyle = isDevil ? '#e11d48' : '#f59e0b';
        ctx.fillRect(-52, -180, 22, 180);
        ctx.fillRect(30, -180, 22, 180);
        ctx.fillStyle = isDevil ? '#3b0764' : '#7c2d12';
        drawRoundRect(ctx, -66, -220, 132, 46, 14);
        ctx.fill();
        ctx.strokeStyle = isDevil ? '#fb7185' : '#ffd700'; ctx.lineWidth = 4; ctx.stroke();
        ctx.fillStyle = isDevil ? '#22d3ee' : '#f43f5e';
        ctx.beginPath(); ctx.moveTo(0, -220); ctx.lineTo(0, -268); ctx.lineTo(44, -250); ctx.lineTo(0, -234); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = "900 17px 'Cairo', sans-serif"; ctx.textAlign = 'center';
        ctx.fillText(isDevil ? '😈 باب النجاة 🚪' : '🏁 النهاية 🏰', 0, -191);
        ctx.restore();
    }

    function drawBunnyCharacterRig(cCtx, ch, runCycle, earBounce, legSwing) {
        if (ch.accessory === 'cosmic') {
            cCtx.save();
            const wingFlap = Math.sin(runCycle * 2.2) * 0.22;
            cCtx.translate(-12, -52);
            cCtx.rotate(-0.35 + wingFlap);
            cCtx.fillStyle = 'rgba(232, 121, 249, 0.85)';
            cCtx.strokeStyle = '#38bdf8'; cCtx.lineWidth = 2;
            cCtx.beginPath(); cCtx.moveTo(0, 0);
            cCtx.quadraticCurveTo(-42, -32, -54, -8); cCtx.quadraticCurveTo(-38, 8, -42, 18); cCtx.quadraticCurveTo(-22, 16, 0, 10);
            cCtx.closePath(); cCtx.fill(); cCtx.stroke();
            cCtx.restore();
        } else if (ch.accessory === 'king') {
            cCtx.save();
            const wave = Math.sin(runCycle * 2) * 6;
            cCtx.fillStyle = '#dc2626'; cCtx.strokeStyle = '#fde047'; cCtx.lineWidth = 2.5;
            cCtx.beginPath(); cCtx.moveTo(-6, -64);
            cCtx.quadraticCurveTo(-36, -52 + wave * 0.5, -48, -16 + wave); cCtx.lineTo(-18, -14);
            cCtx.closePath(); cCtx.fill(); cCtx.stroke();
            cCtx.restore();
        } else if (ch.accessory === 'ninja') {
            cCtx.save();
            const wave = Math.sin(runCycle * 2.6) * 8;
            cCtx.fillStyle = ch.bowColor || '#ef4444';
            cCtx.beginPath(); cCtx.moveTo(-4, -62);
            cCtx.quadraticCurveTo(-34, -68 + wave * 0.6, -56, -54 + wave); cCtx.quadraticCurveTo(-36, -46 + wave * 0.4, -6, -52);
            cCtx.closePath(); cCtx.fill();
            cCtx.restore();
        }

        cCtx.fillStyle = ch.tailColor || '#fff';
        cCtx.beginPath(); cCtx.arc(-26, -30 + Math.sin(runCycle * 2) * 3, 11, 0, Math.PI * 2); cCtx.fill();

        cCtx.save(); cCtx.translate(-8, -18); cCtx.rotate(-legSwing);
        cCtx.fillStyle = ch.furDark || '#9ca3af';
        cCtx.beginPath(); cCtx.ellipse(0, 12, 15, 8, 0.2, 0, Math.PI * 2); cCtx.fill();
        cCtx.restore();

        const bodyGrad = cCtx.createRadialGradient(4, -44, 6, 0, -44, 32);
        bodyGrad.addColorStop(0, ch.furLight); bodyGrad.addColorStop(0.55, ch.furMid); bodyGrad.addColorStop(1, ch.furDark);
        cCtx.fillStyle = bodyGrad;
        cCtx.beginPath(); cCtx.ellipse(0, -42, 25, 30, -0.1, 0, Math.PI * 2); cCtx.fill();
        cCtx.strokeStyle = ch.stroke; cCtx.lineWidth = 2.5; cCtx.stroke();

        if (ch.accessory === 'cyber') {
            cCtx.save(); cCtx.fillStyle = '#22d3ee';
            cCtx.beginPath(); cCtx.arc(10, -46, 7, 0, Math.PI * 2); cCtx.fill();
            cCtx.strokeStyle = '#fff'; cCtx.lineWidth = 2; cCtx.stroke(); cCtx.restore();
        } else if (ch.accessory === 'ninja') {
            cCtx.fillStyle = ch.bowColor || '#dc2626'; cCtx.fillRect(-19, -42, 40, 6);
            cCtx.fillStyle = '#fde047'; cCtx.beginPath(); cCtx.arc(8, -39, 4, 0, Math.PI * 2); cCtx.fill();
        } else {
            cCtx.fillStyle = ch.bowColor || '#f43f5e';
            cCtx.beginPath(); cCtx.ellipse(6, -58, 7, 4.5, -0.3, 0, Math.PI * 2); cCtx.ellipse(17, -58, 7, 4.5, 0.3, 0, Math.PI * 2); cCtx.fill();
            cCtx.fillStyle = '#fde047'; cCtx.beginPath(); cCtx.arc(11.5, -58, 3, 0, Math.PI * 2); cCtx.fill();
        }

        cCtx.save(); cCtx.translate(10, -16); cCtx.rotate(legSwing);
        cCtx.fillStyle = ch.footColor || '#e7e5e4';
        cCtx.beginPath(); cCtx.ellipse(4, 12, 16, 8, -0.15, 0, Math.PI * 2); cCtx.fill();
        cCtx.restore();

        const headCenterX = 6, headCenterY = -90 + earBounce * 0.4;
        const earWiggle = Math.sin(runCycle * 1.5) * 0.12;

        cCtx.save(); cCtx.translate(headCenterX - 12, headCenterY - 22); cCtx.rotate(-0.28 + earWiggle);
        cCtx.fillStyle = ch.earOuter; cCtx.beginPath(); cCtx.ellipse(0, -22, 9, 26, 0, 0, Math.PI * 2); cCtx.fill();
        cCtx.strokeStyle = ch.stroke; cCtx.lineWidth = 1.5; cCtx.stroke();
        cCtx.fillStyle = ch.earInner; cCtx.beginPath(); cCtx.ellipse(0, -20, 4.5, 18, 0, 0, Math.PI * 2); cCtx.fill();
        cCtx.restore();

        cCtx.save(); cCtx.translate(headCenterX + 10, headCenterY - 22); cCtx.rotate(0.18 - earWiggle);
        cCtx.fillStyle = ch.earOuter; cCtx.beginPath(); cCtx.ellipse(0, -24, 10, 28, 0, 0, Math.PI * 2); cCtx.fill();
        cCtx.strokeStyle = ch.stroke; cCtx.lineWidth = 1.5; cCtx.stroke();
        cCtx.fillStyle = ch.earInner; cCtx.beginPath(); cCtx.ellipse(0, -22, 5, 19, 0, 0, Math.PI * 2); cCtx.fill();

        if (ch.accessory === 'cyber') {
            cCtx.strokeStyle = '#22d3ee'; cCtx.lineWidth = 2.5;
            cCtx.beginPath(); cCtx.moveTo(0, -50); cCtx.lineTo(0, -62); cCtx.stroke();
            cCtx.fillStyle = '#f43f5e'; cCtx.beginPath(); cCtx.arc(0, -64, 4, 0, Math.PI * 2); cCtx.fill();
        } else {
            cCtx.fillStyle = ch.bowColor || '#ec4899'; cCtx.strokeStyle = '#fff'; cCtx.lineWidth = 1.5;
            cCtx.beginPath(); cCtx.ellipse(-7, -9, 8, 5, -0.3, 0, Math.PI * 2); cCtx.ellipse(7, -9, 8, 5, 0.3, 0, Math.PI * 2); cCtx.fill(); cCtx.stroke();
            cCtx.fillStyle = '#ffd700'; cCtx.beginPath(); cCtx.arc(0, -9, 3.5, 0, Math.PI * 2); cCtx.fill();
        }
        cCtx.restore();

        cCtx.save(); cCtx.translate(headCenterX, headCenterY); cCtx.rotate(Math.sin(runCycle) * 0.08);
        if (stickerFaceImg.complete && stickerFaceImg.naturalWidth > 0) cCtx.drawImage(stickerFaceImg, -32, -43, 64, 78);

        if (ch.accessory === 'crown' || ch.accessory === 'king' || ch.accessory === 'cosmic') {
            cCtx.save(); cCtx.translate(0, -40);
            cCtx.fillStyle = ch.accessory === 'cosmic' ? '#e879f9' : '#ffd700';
            cCtx.strokeStyle = '#713f12'; cCtx.lineWidth = 1.8;
            cCtx.beginPath(); cCtx.moveTo(-16, 0); cCtx.lineTo(-18, -14); cCtx.lineTo(-8, -7); cCtx.lineTo(0, -18); cCtx.lineTo(8, -7); cCtx.lineTo(18, -14); cCtx.lineTo(16, 0);
            cCtx.closePath(); cCtx.fill(); cCtx.stroke();
            cCtx.fillStyle = ch.id === 'snow_princess' ? '#38bdf8' : '#ef4444';
            cCtx.beginPath(); cCtx.arc(0, -7, 3, 0, Math.PI * 2); cCtx.fill(); cCtx.restore();
        } else if (ch.accessory === 'ninja') {
            cCtx.save(); cCtx.fillStyle = ch.bowColor || '#dc2626'; cCtx.fillRect(-26, -32, 52, 8);
            cCtx.fillStyle = '#cbd5e1'; cCtx.fillRect(-10, -31, 20, 6); cCtx.restore();
        } else if (ch.accessory === 'cyber') {
            cCtx.save(); cCtx.fillStyle = 'rgba(6, 182, 212, 0.72)'; cCtx.strokeStyle = '#a5f3fc'; cCtx.lineWidth = 2;
            drawRoundRect(cCtx, -24, -14, 48, 13, 5); cCtx.fill(); cCtx.stroke(); cCtx.restore();
        }

        cCtx.strokeStyle = ch.accessory === 'cyber' ? '#22d3ee' : 'rgba(255, 255, 255, 0.85)';
        cCtx.lineWidth = 1.8;
        cCtx.beginPath();
        cCtx.moveTo(22, 4); cCtx.lineTo(44, -2); cCtx.moveTo(22, 9); cCtx.lineTo(46, 9);
        cCtx.moveTo(-22, 4); cCtx.lineTo(-42, -2); cCtx.moveTo(-22, 9); cCtx.lineTo(-44, 9);
        cCtx.stroke();
        cCtx.restore();
    }

    function drawHoverboard(cCtx, bd, px, py) {
        if (!bd || bd.id === 'none') return;
        cCtx.save();
        cCtx.translate(px + 2, py + 4);
        cCtx.fillStyle = bd.color;
        cCtx.strokeStyle = '#ffffff';
        cCtx.lineWidth = 2;
        drawRoundRect(cCtx, -36, -6, 72, 11, 6);
        cCtx.fill();
        cCtx.stroke();
        // Thruster glow
        cCtx.fillStyle = 'rgba(253, 224, 71, 0.85)';
        cCtx.beginPath();
        cCtx.ellipse(-36, 0, 10 + Math.sin(frameCount * 0.5) * 4, 4, 0, 0, Math.PI * 2);
        cCtx.fill();
        cCtx.restore();
    }

    function drawJetpackRig(cCtx, px, py, thrustOn) {
        cCtx.save();
        cCtx.translate(px - 24, py - 50);
        // Flame
        const fLen = (thrustOn ? 28 : 14) + Math.sin(frameCount * 0.7) * 6;
        cCtx.fillStyle = '#f97316';
        cCtx.beginPath(); cCtx.moveTo(-6, 12); cCtx.lineTo(-10 - fLen * 0.25, 18 + fLen); cCtx.lineTo(4, 12); cCtx.closePath(); cCtx.fill();
        cCtx.fillStyle = '#fde047';
        cCtx.beginPath(); cCtx.moveTo(-3, 12); cCtx.lineTo(-6 - fLen * 0.12, 16 + fLen * 0.65); cCtx.lineTo(1, 12); cCtx.closePath(); cCtx.fill();
        // Pack tank
        cCtx.fillStyle = '#0ea5e9';
        cCtx.strokeStyle = '#e0f2fe';
        cCtx.lineWidth = 2;
        drawRoundRect(cCtx, -10, -18, 16, 30, 6);
        cCtx.fill(); cCtx.stroke();
        cCtx.fillStyle = '#f43f5e';
        cCtx.fillRect(-7, -10, 10, 6);
        cCtx.restore();
    }

    function drawOnlineRivals() {
        if (gameMode !== 'online') return;
        const ps = getActivePlayStyle();
        onlineRacers.forEach((r, idx) => {
            const relX = player.x + (r.distance - distance) * 0.35;
            if (relX < -120 || relX > V_WIDTH + 120) return;
            const ry = ps === 'lanes'
                ? getLaneY((idx * 2) % 3) + r.jumpY * 0.5
                : ps === 'jetpack'
                    ? (groundY - 120 - (idx % 3) * 65 + Math.sin(frameCount * 0.06 + idx) * 24)
                    : groundY + r.jumpY;

            ctx.save();
            ctx.globalAlpha = 0.82;
            if (ps === 'jetpack') drawJetpackRig(ctx, relX, ry, true);
            else drawHoverboard(ctx, r.board, relX, ry);
            ctx.translate(relX, ry);
            ctx.scale(0.88, 0.88);
            drawBunnyCharacterRig(ctx, r.char, frameCount * 0.25, Math.sin(frameCount * 0.3) * 4, Math.sin(frameCount * 0.25) * 0.6);
            ctx.restore();

            ctx.save();
            ctx.font = "800 13px 'Cairo', sans-serif";
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(7, 11, 22, 0.82)';
            drawRoundRect(ctx, relX - 46, ry - 165, 92, 22, 10);
            ctx.fill();
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(r.username.slice(0, 12), relX, ry - 149);

            if (r.emote && r.emoteTimer > 0) {
                ctx.font = '24px sans-serif';
                ctx.fillText(r.emote, relX, ry - 178);
            }
            ctx.restore();
        });
    }

    function drawBunnyPlayer() {
        const ch = getActiveChar();
        const pet = getActivePet();
        const bd = getActiveBoard();
        const trail = getActiveTrail();
        const ps = getActivePlayStyle();

        // Custom Running Trail
        player.trail.forEach((t, idx) => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, t.alpha * 0.55);
            const col = trail.colors[idx % trail.colors.length] || ch.trailColor;
            ctx.fillStyle = col;
            if (trail.id === 'hearts') {
                ctx.font = `${Math.round(t.size * 1.6)}px sans-serif`;
                ctx.fillText('💖', t.x, t.y);
            } else if (trail.id === 'lightning') {
                ctx.font = `${Math.round(t.size * 1.6)}px sans-serif`;
                ctx.fillText('⚡', t.x, t.y);
            } else {
                ctx.beginPath();
                ctx.arc(t.x, t.y, t.size * (dashTimer > 0 ? 1.8 : 1.1), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        });

        ctx.save();
        if (invincibleFrames > 0 && Math.floor(invincibleFrames / 4) % 2 === 0 && dashTimer <= 0) {
            ctx.globalAlpha = 0.48;
        }

        const px = player.x;
        const visY = player.getVisualY();
        const activeBoardToDraw = ps === 'lanes' && bd.id === 'none' ? { id: 'lane_surf', color: '#06b6d4' } : bd;
        const py = visY - (activeBoardToDraw.id !== 'none' && ps !== 'jetpack' ? 10 : 0);
        const isAir = ps === 'jetpack' ? true : ps === 'lanes' ? player.hopY < -4 : player.y < groundY - 5;
        const slideScaleY = player.isSliding ? 0.58 : 1.0;
        const slideScaleX = player.isSliding ? 1.18 : 1.0;

        const shadowY = ps === 'lanes' ? player.y + 6 : groundY + 6;
        const shadowHeightDelta = ps === 'lanes' ? Math.abs(player.hopY) : Math.max(0, groundY - player.y);
        const shadowScale = Math.max(0.32, 1 - shadowHeightDelta / 280);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
        ctx.beginPath();
        ctx.ellipse(px, shadowY, 34 * shadowScale, 9 * shadowScale, 0, 0, Math.PI * 2);
        ctx.fill();

        if (ch.accessory === 'cosmic' || feverTimer > 0) {
            ctx.save();
            ctx.strokeStyle = feverTimer > 0 ? 'rgba(253, 224, 71, 0.85)' : 'rgba(232, 121, 249, 0.55)';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(px + 4, py - 56, 58 + Math.sin(frameCount * 0.14) * 4, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
        }

        if (shieldActive || boardShieldReady) {
            ctx.save();
            ctx.strokeStyle = shieldActive ? 'rgba(253, 224, 71, 0.85)' : 'rgba(34, 211, 238, 0.65)';
            ctx.fillStyle = shieldActive ? 'rgba(253, 224, 71, 0.14)' : 'rgba(34, 211, 238, 0.09)';
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(px + 4, py - 56, 65, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.restore();
        }

        if (ps === 'jetpack') {
            drawJetpackRig(ctx, px, py, jetpackHoldUp || player.vy < 0 || dashTimer > 0);
            // Forward laser reticle
            ctx.save();
            ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(px + 38, py - 54); ctx.lineTo(px + 135, py - 54); ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.arc(px + 142, py - 54, 8, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
        } else {
            drawHoverboard(ctx, activeBoardToDraw, px, py);
        }

        ctx.translate(px, py);
        ctx.scale(slideScaleX, slideScaleY);
        const tilt = dashTimer > 0 ? 0.25 : ps === 'jetpack' ? player.vy * 0.025 : isAir ? (ps === 'lanes' ? player.hopVy : player.vy) * 0.015 : Math.sin(player.runCycle) * 0.06;
        ctx.rotate(tilt);
        const legSwing = isAir ? 0.45 : Math.sin(player.runCycle) * 0.65;
        drawBunnyCharacterRig(ctx, ch, player.runCycle, player.earBounce, legSwing);
        ctx.restore();

        // Companion Pet floating beside bunny
        if (pet.id !== 'none') {
            ctx.save();
            const petX = px - 58;
            const petY = py - 95 + Math.sin(frameCount * 0.11) * 12;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
            ctx.strokeStyle = pet.color;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(petX, petY, 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.font = '24px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pet.icon, petX, petY + 2);
            ctx.restore();
        }

        // Player live emote bubble
        if (playerEmote && playerEmoteTimer > 0) {
            ctx.save();
            ctx.font = '32px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(playerEmote, px + 10, py - 172);
            ctx.restore();
        }
    }

    function drawBossAndExtras() {
        // Sky Rings (Jetpack mode)
        skyRingsList.forEach(sr => {
            ctx.save();
            ctx.translate(sr.x, sr.y);
            ctx.strokeStyle = '#fde047';
            ctx.lineWidth = 6;
            ctx.beginPath(); ctx.ellipse(0, 0, 17, sr.radius, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.ellipse(0, 0, 11, sr.radius - 7, 0, 0, Math.PI * 2); ctx.stroke();
            ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('✨', 0, 0);
            ctx.restore();
        });

        // Player Plasma Lasers
        playerLasers.forEach(ls => {
            ctx.save();
            ctx.translate(ls.x, ls.y);
            ctx.fillStyle = 'rgba(34, 211, 238, 0.28)';
            drawRoundRect(ctx, -22, -8, 40, 16, 8);
            ctx.fill();
            const grad = ctx.createLinearGradient(-18, 0, 14, 0);
            grad.addColorStop(0, 'rgba(34, 211, 238, 0)');
            grad.addColorStop(0.5, '#22d3ee');
            grad.addColorStop(1, '#ffffff');
            ctx.fillStyle = grad;
            drawRoundRect(ctx, -18, -4, 32, 8, 4);
            ctx.fill();
            ctx.restore();
        });

        // 3-Lane Tactical Gates
        laneGatesList.forEach(g => {
            ctx.save();
            ctx.translate(g.x, g.y);
            ctx.fillStyle = g.color + '33';
            ctx.strokeStyle = g.color;
            ctx.lineWidth = 3;
            drawRoundRect(ctx, -32, -26, 64, 48, 12);
            ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#ffffff';
            ctx.font = "900 13px 'Cairo', sans-serif";
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(g.label, 0, -2);
            ctx.restore();
        });

        feverPortalsList.forEach(fp => {
            ctx.save();
            ctx.translate(fp.x, fp.y);
            ctx.rotate(frameCount * 0.08);
            const g = ctx.createRadialGradient(0, 0, 6, 0, 0, fp.radius);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(0.4, '#fde047');
            g.addColorStop(0.8, '#ec4899');
            g.addColorStop(1, 'rgba(124, 58, 237, 0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(0, 0, fp.radius, 0, Math.PI * 2); ctx.fill();
            ctx.font = '26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('🌈', 0, 0);
            ctx.restore();
        });

        petFireballs.forEach(fb => {
            ctx.save();
            ctx.fillStyle = '#f97316';
            ctx.beginPath(); ctx.arc(fb.x, fb.y, 12, 0, Math.PI * 2); ctx.fill();
            ctx.font = '20px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('🔥', fb.x, fb.y);
            ctx.restore();
        });

        if (bossEntity) {
            ctx.save();
            ctx.translate(bossEntity.x, bossEntity.y);
            const aura = ctx.createRadialGradient(0, 0, 15, 0, 0, 82);
            aura.addColorStop(0, 'rgba(244, 63, 94, 0.75)');
            aura.addColorStop(1, 'rgba(244, 63, 94, 0)');
            ctx.fillStyle = aura;
            ctx.beginPath(); ctx.arc(0, 0, 82, 0, Math.PI * 2); ctx.fill();
            ctx.font = '86px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(bossEntity.icon, 0, 0);
            ctx.restore();
        }

        bossProjectiles.forEach(bp => {
            ctx.save();
            ctx.fillStyle = '#ef4444';
            ctx.beginPath(); ctx.arc(bp.x, bp.y, bp.radius, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#fde047'; ctx.lineWidth = 3; ctx.stroke();
            ctx.restore();
        });

        bossMissiles.forEach(bm => {
            ctx.save();
            ctx.fillStyle = 'rgba(34, 211, 238, 0.25)';
            ctx.beginPath(); ctx.arc(bm.x, bm.y, bm.radius + 6, 0, Math.PI * 2); ctx.fill();
            ctx.font = '28px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('🚀', bm.x, bm.y);
            ctx.restore();
        });
    }

    function drawCarrotItem(c) {
        if (c.x < -40 || c.x > V_WIDTH + 40) return;
        ctx.save();
        const bob = Math.sin(frameCount * 0.09 + c.bobOffset) * 5;
        ctx.translate(c.x, c.y + bob);
        ctx.rotate(Math.sin(frameCount * 0.06 + c.bobOffset) * 0.15 + 0.35);

        if (c.isGolden) {
            const gAura = ctx.createRadialGradient(0, 2, 4, 0, 2, 26);
            gAura.addColorStop(0, 'rgba(253, 224, 71, 0.55)');
            gAura.addColorStop(1, 'rgba(253, 224, 71, 0)');
            ctx.fillStyle = gAura;
            ctx.beginPath(); ctx.arc(0, 2, 26, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.ellipse(-5, -20, 4, 9, -0.35, 0, Math.PI * 2);
        ctx.ellipse(0, -22, 4.5, 11, 0, 0, Math.PI * 2);
        ctx.ellipse(5, -20, 4, 9, 0.35, 0, Math.PI * 2);
        ctx.fill();

        const cGrad = ctx.createLinearGradient(-11, -13, 11, 20);
        cGrad.addColorStop(0, c.isGolden ? '#fef08a' : '#fdba74');
        cGrad.addColorStop(0.45, c.isGolden ? '#eab308' : '#f97316');
        cGrad.addColorStop(1, c.isGolden ? '#b45309' : '#c2410c');
        ctx.fillStyle = cGrad;
        ctx.beginPath();
        ctx.moveTo(-11, -13); ctx.quadraticCurveTo(0, -17, 11, -13);
        ctx.lineTo(2, 20); ctx.quadraticCurveTo(0, 24, -2, 20);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();

        // 3D Glossy specular highlight streak
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.beginPath();
        ctx.ellipse(-3.5, -3, 2.2, 9, 0.14, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    function drawPowerupItem(pw) {
        if (pw.x < -40 || pw.x > V_WIDTH + 40) return;
        ctx.save();
        const bob = Math.sin(frameCount * 0.1) * 6;
        ctx.translate(pw.x, pw.y + bob);
        const ringColor = pw.type === 'magnet' ? '#f43f5e' : pw.type === 'shield' ? '#ffd700' : '#38bdf8';

        // Outer volumetric 5D aura pulse
        const pulse = 28 + Math.sin(frameCount * 0.14) * 5;
        const pAura = ctx.createRadialGradient(0, 0, 8, 0, 0, pulse);
        pAura.addColorStop(0, ringColor + '66');
        pAura.addColorStop(1, ringColor + '00');
        ctx.fillStyle = pAura;
        ctx.beginPath(); ctx.arc(0, 0, pulse, 0, Math.PI * 2); ctx.fill();

        const orbGrad = ctx.createRadialGradient(-6, -6, 3, 0, 0, 23);
        orbGrad.addColorStop(0, '#334155');
        orbGrad.addColorStop(1, 'rgba(7, 11, 22, 0.95)');
        ctx.fillStyle = orbGrad; ctx.strokeStyle = ringColor; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 23, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = '22px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(pw.type === 'magnet' ? '🧲' : pw.type === 'shield' ? '🛡️' : '⚡', 0, 2);
        ctx.restore();
    }

    function drawObstacleItem(o) {
        ctx.save();
        ctx.translate(o.x, o.y);

        // Ground contact shadow for depth
        if (!o.isAerial && o.type !== 'falling_pillar') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
            ctx.beginPath();
            ctx.ellipse(0, 3, (o.hitW / 2) + 8, 6, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        if (o.type === 'rock' || o.type === 'crystal_spike') {
            const h = o.hitH + 2, w = o.hitW / 2 + 2;
            const rGrad = ctx.createLinearGradient(-w, -h, w, 0);
            if (o.type === 'crystal_spike') {
                rGrad.addColorStop(0, '#f0abfc');
                rGrad.addColorStop(0.5, '#a855f7');
                rGrad.addColorStop(1, '#4c1d95');
            } else {
                rGrad.addColorStop(0, '#94a3b8');
                rGrad.addColorStop(0.55, '#64748b');
                rGrad.addColorStop(1, '#334155');
            }
            ctx.fillStyle = rGrad;
            ctx.strokeStyle = o.type === 'crystal_spike' ? '#fae8ff' : '#1e293b';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(-w * 0.65, -h * 0.72); ctx.lineTo(0, -h); ctx.lineTo(w * 0.65, -h * 0.7); ctx.lineTo(w, 0);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            // 3D lit left facet
            ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
            ctx.beginPath(); ctx.moveTo(-w + 2, 0); ctx.lineTo(-w * 0.62, -h * 0.7); ctx.lineTo(0, -h + 2); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
        } else if (o.type === 'log') {
            const lGrad = ctx.createLinearGradient(0, -o.hitH, 0, 0);
            lGrad.addColorStop(0, '#b45309'); lGrad.addColorStop(1, '#451a03');
            ctx.fillStyle = lGrad; ctx.strokeStyle = '#fde68a55'; ctx.lineWidth = 2;
            drawRoundRect(ctx, -o.hitW / 2, -o.hitH, o.hitW, o.hitH, 8); ctx.fill(); ctx.stroke();
            // Bark grain + leaf sprout
            ctx.fillStyle = '#fde68a';
            ctx.beginPath(); ctx.arc(o.hitW / 2 - 8, -o.hitH / 2, 6, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#22c55e';
            ctx.beginPath(); ctx.ellipse(-6, -o.hitH - 4, 7, 3.5, -0.4, 0, Math.PI * 2); ctx.fill();
        } else if (o.type === 'cactus') {
            const cxGrad = ctx.createLinearGradient(-10, -o.hitH, 10, 0);
            cxGrad.addColorStop(0, '#4ade80'); cxGrad.addColorStop(0.6, '#16a34a'); cxGrad.addColorStop(1, '#052e16');
            ctx.fillStyle = cxGrad; ctx.strokeStyle = '#052e16'; ctx.lineWidth = 2.2;
            drawRoundRect(ctx, -10, -o.hitH - 2, 20, o.hitH + 2, 10); ctx.fill(); ctx.stroke();
            // Classic cactus arms
            drawRoundRect(ctx, -20, -o.hitH * 0.72, 12, 8, 4); ctx.fill();
            drawRoundRect(ctx, 8, -o.hitH * 0.56, 12, 8, 4); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            [-o.hitH * 0.78, -o.hitH * 0.45].forEach(sy => {
                ctx.fillRect(-3, sy, 2, 4);
                ctx.fillRect(3, sy + 6, 2, 4);
            });
        } else if (o.type === 'ninja_fox') {
            ctx.fillStyle = '#ea580c'; ctx.strokeStyle = '#7c2d12'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(0, -18, 22, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-12, -26); ctx.lineTo(-30, -18); ctx.lineTo(-14, -10); ctx.closePath(); ctx.fill();
            // Ninja bandana + eye glow
            ctx.fillStyle = '#0f172a'; ctx.fillRect(-16, -24, 30, 7);
            ctx.fillStyle = '#38bdf8'; ctx.fillRect(-12, -22, 6, 3);
            ctx.fillStyle = '#e11d48'; ctx.fillRect(10, -25, 14, 4);
            if (!o.jumped && o.x > player.x + 140) {
                ctx.fillStyle = '#fde047'; ctx.font = "900 14px 'Cairo', sans-serif"; ctx.textAlign = 'center';
                ctx.fillText('⚠️ اقفز!', 0, -40);
            }
        } else if (o.type === 'fire') {
            ctx.fillStyle = '#334155';
            drawRoundRect(ctx, -18, -10, 36, 10, 4); ctx.fill();
            const fl = Math.sin(frameCount * 0.35) * 4;
            ctx.fillStyle = '#ef4444';
            ctx.beginPath(); ctx.moveTo(-o.hitW / 2, -6); ctx.quadraticCurveTo(-o.hitW / 2, -o.hitH * 0.72, 0, -o.hitH - 4 + fl); ctx.quadraticCurveTo(o.hitW / 2, -o.hitH * 0.72, o.hitW / 2, -6); ctx.fill();
            ctx.fillStyle = '#facc15';
            ctx.beginPath(); ctx.moveTo(-9, -6); ctx.quadraticCurveTo(-9, -22, 0, -34 + fl * 0.5); ctx.quadraticCurveTo(9, -22, 9, -6); ctx.fill();
        } else if (o.type === 'spike_roller' || o.type === 'troll_saw') {
            ctx.save();
            ctx.translate(0, -o.hitH / 2); ctx.rotate(o.rot || 0);
            ctx.fillStyle = o.type === 'troll_saw' ? '#f43f5e' : '#dc2626';
            for (let i = 0; i < 8; i++) {
                ctx.rotate(Math.PI / 4);
                ctx.beginPath(); ctx.moveTo(-5, -14); ctx.lineTo(0, -23); ctx.lineTo(5, -14); ctx.fill();
            }
            const sGrad = ctx.createRadialGradient(-4, -4, 2, 0, 0, 15);
            sGrad.addColorStop(0, o.type === 'troll_saw' ? '#fda4af' : '#94a3b8');
            sGrad.addColorStop(1, '#1e293b');
            ctx.fillStyle = sGrad; ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            if (o.type === 'troll_saw') {
                ctx.fillStyle = '#fda4af'; ctx.font = "900 12px 'Cairo', sans-serif"; ctx.textAlign = 'center';
                ctx.fillText('😈', 0, -o.hitH - 6);
            }
        } else if (o.type === 'smart_drone') {
            // Downward scanner cone + overhead slide telegraph
            ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
            ctx.beginPath(); ctx.moveTo(-14, -10); ctx.lineTo(14, -10); ctx.lineTo(24, 52); ctx.lineTo(-24, 52); ctx.closePath(); ctx.fill();
            // Twin spinning rotors
            const rw = 10 + Math.abs(Math.sin(frameCount * 0.6)) * 6;
            ctx.fillStyle = '#e2e8f0';
            ctx.fillRect(-16 - rw / 2, -31, rw, 3);
            ctx.fillRect(16 - rw / 2, -31, rw, 3);
            ctx.fillStyle = '#0284c7'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(0, -19, 22, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(-11, -19, 4.5, 0, Math.PI * 2); ctx.fill();
            if (!o.isAerial) {
                ctx.fillStyle = '#67e8f9'; ctx.font = "900 13px 'Cairo', sans-serif"; ctx.textAlign = 'center';
                ctx.fillText('⬇️ انزلق', 0, -37);
            }
        } else if (o.type === 'hidden_spikes') {
            // Base plate always visible with faint warning rivets
            ctx.fillStyle = '#334155';
            drawRoundRect(ctx, -o.hitW / 2 - 4, -7, o.hitW + 8, 8, 3); ctx.fill();
            ctx.fillStyle = o.triggered ? '#fb7185' : '#f43f5e88';
            ctx.fillRect(-o.hitW / 2, -5, o.hitW, 2);
            const popH = Math.max(4, o.hitH * (o.popProgress || 0));
            if ((o.popProgress || 0) > 0.05) {
                const spGrad = ctx.createLinearGradient(0, -popH, 0, 0);
                spGrad.addColorStop(0, '#fecdd3'); spGrad.addColorStop(0.5, '#e11d48'); spGrad.addColorStop(1, '#4c0519');
                ctx.fillStyle = spGrad; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
                for (let sx = -18; sx <= 18; sx += 12) {
                    ctx.beginPath(); ctx.moveTo(sx - 6, -4); ctx.lineTo(sx, -popH); ctx.lineTo(sx + 6, -4); ctx.closePath();
                    ctx.fill(); ctx.stroke();
                }
            }
        } else if (o.type === 'sliding_spike') {
            ctx.fillStyle = '#1e293b'; ctx.fillRect(-26, -6, 52, 6);
            const sGrad = ctx.createLinearGradient(0, -o.hitH, 0, 0);
            sGrad.addColorStop(0, '#fda4af'); sGrad.addColorStop(1, '#9f1239');
            ctx.fillStyle = sGrad; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-20, -4); ctx.lineTo(-10, -o.hitH); ctx.lineTo(0, -14); ctx.lineTo(10, -o.hitH); ctx.lineTo(20, -4); ctx.closePath();
            ctx.fill(); ctx.stroke();
        } else if (o.type === 'falling_pillar') {
            // Ground warning reticle beneath falling pillar
            if (!o.isAerial && o.y < groundY - 4) {
                const gDelta = groundY - o.y;
                ctx.fillStyle = 'rgba(244, 63, 94, 0.38)';
                ctx.beginPath(); ctx.ellipse(0, gDelta + 2, 24, 6, 0, 0, Math.PI * 2); ctx.fill();
            }
            const pGrad = ctx.createLinearGradient(-o.hitW / 2, -o.hitH, o.hitW / 2, 0);
            pGrad.addColorStop(0, '#475569'); pGrad.addColorStop(0.5, '#1e293b'); pGrad.addColorStop(1, '#090d16');
            ctx.fillStyle = pGrad; ctx.strokeStyle = '#fb7185'; ctx.lineWidth = 2.5;
            drawRoundRect(ctx, -o.hitW / 2, -o.hitH, o.hitW, o.hitH, 8); ctx.fill(); ctx.stroke();
            // Danger chevrons
            ctx.fillStyle = '#fb7185'; ctx.font = "900 13px 'Cairo', sans-serif"; ctx.textAlign = 'center';
            ctx.fillText(o.isLowPass ? '⬇️ انزلق!' : '⚠️ تحطّم', 0, -o.hitH / 2 + 4);
        } else if (o.type === 'troll_carrot') {
            // Tempting devil carrot that snaps into spikes when triggered
            const cGrad = ctx.createLinearGradient(-10, -34, 10, 0);
            cGrad.addColorStop(0, o.triggered ? '#fb7185' : '#fef08a');
            cGrad.addColorStop(1, o.triggered ? '#be123c' : '#ea580c');
            ctx.fillStyle = cGrad; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-10, -30); ctx.lineTo(10, -30); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = o.triggered ? '#f43f5e' : '#a855f7';
            ctx.font = "900 13px 'Cairo', sans-serif"; ctx.textAlign = 'center';
            ctx.fillText(o.triggered ? '💥😈' : '😈؟', 0, -38);
        } else if (o.type === 'ufo') {
            const uAura = ctx.createRadialGradient(0, 4, 6, 0, 4, 34);
            uAura.addColorStop(0, 'rgba(168, 85, 247, 0.35)');
            uAura.addColorStop(1, 'rgba(168, 85, 247, 0)');
            ctx.fillStyle = uAura;
            ctx.beginPath(); ctx.arc(0, 4, 34, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#a855f7'; ctx.strokeStyle = '#e9d5ff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(0, 4, 24, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#38bdf8';
            ctx.beginPath(); ctx.arc(0, -3, 12, Math.PI, 0); ctx.fill();
            ctx.fillStyle = 'rgba(244, 63, 94, 0.9)';
            [-12, 0, 12].forEach(lx => { ctx.beginPath(); ctx.arc(lx, 5, 2.8, 0, Math.PI * 2); ctx.fill(); });
        } else if (o.type === 'meteor') {
            ctx.rotate(o.rot || 0);
            ctx.fillStyle = '#f97316';
            ctx.beginPath(); ctx.arc(0, 0, 21, 0, Math.PI * 2); ctx.fill();
            const mGrad = ctx.createRadialGradient(-5, -5, 2, 0, 0, 15);
            mGrad.addColorStop(0, '#fb923c'); mGrad.addColorStop(1, '#451a03');
            ctx.fillStyle = mGrad; ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        } else if (o.type === 'sky_drone') {
            ctx.fillStyle = '#ec4899'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.ellipse(0, 0, 22, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#fde047';
            ctx.beginPath(); ctx.arc(-11, 0, 4.5, 0, Math.PI * 2); ctx.fill();
        } else if (o.type === 'laser_gate') {
            const cyc = Math.floor(o.cycle) % 100;
            const isOff = cyc >= 46;
            const isPreFireWarn = cyc >= 86;
            ctx.fillStyle = '#475569'; ctx.fillRect(-10, -o.hitH - 10, 20, 12); ctx.fillRect(-10, -10, 20, 10);
            if (!isOff) {
                ctx.fillStyle = 'rgba(244, 63, 94, 0.34)'; ctx.fillRect(-9, -o.hitH, 18, o.hitH - 10);
                ctx.fillStyle = '#f43f5e'; ctx.fillRect(-4, -o.hitH, 8, o.hitH - 10);
                ctx.fillStyle = '#fff'; ctx.fillRect(-1.5, -o.hitH, 3, o.hitH - 10);
            } else if (isPreFireWarn && Math.floor(frameCount / 3) % 2 === 0) {
                ctx.fillStyle = 'rgba(251, 191, 36, 0.45)';
                ctx.fillRect(-2, -o.hitH, 4, o.hitH - 10);
            }
        }
        ctx.restore();
    }

    function draw5DForegroundEffects() {
        // 1. Expanding Shockwaves
        shockwavesList.forEach(sw => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, sw.alpha);
            ctx.strokeStyle = sw.color;
            ctx.lineWidth = 3.5;
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, Math.max(4, sw.r * 0.86), 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        });

        // 2. High-Speed / Dash / Fever 5D Speed Lines
        if (state === 'PLAYING' && (dashTimer > 0 || feverTimer > 0 || worldSpeed > 11)) {
            ctx.save();
            const intensity = dashTimer > 0 || feverTimer > 0 ? 0.32 : 0.14;
            ctx.strokeStyle = feverTimer > 0 ? `rgba(253, 224, 71, ${intensity})` : `rgba(103, 232, 249, ${intensity})`;
            ctx.lineWidth = 2;
            const lOff = (frameCount * 28) % 240;
            for (let i = 0; i < 8; i++) {
                const ly = (i % 2 === 0 ? 28 + i * 22 : V_HEIGHT - 32 - i * 18);
                const lx = V_WIDTH - ((lOff + i * 190) % (V_WIDTH + 200));
                ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 115, ly); ctx.stroke();
            }
            ctx.restore();
        }

        // 3. Foreground 5D Depth Bokeh Light Orbs
        ctx.save();
        fgBokehList.forEach(bk => {
            if (!isPortraitBlocked) {
                bk.x += bk.vx * (state === 'PLAYING' ? 1.35 : 0.65);
                bk.y += bk.vy + Math.sin(frameCount * 0.03 + bk.phase) * 0.3;
                if (bk.x < -bk.r * 2) bk.x = V_WIDTH + bk.r * 2;
                if (bk.y < -bk.r) bk.y = V_HEIGHT + bk.r;
                if (bk.y > V_HEIGHT + bk.r) bk.y = -bk.r;
            }
            const bGrad = ctx.createRadialGradient(bk.x, bk.y, 2, bk.x, bk.y, bk.r);
            bGrad.addColorStop(0, bk.color);
            bGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = bGrad;
            ctx.beginPath(); ctx.arc(bk.x, bk.y, bk.r, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();

        // 4. Subtle Cinematic Depth Vignette
        ctx.save();
        const vig = ctx.createRadialGradient(V_WIDTH * 0.5, V_HEIGHT * 0.5, V_WIDTH * 0.32, V_WIDTH * 0.5, V_HEIGHT * 0.5, V_WIDTH * 0.72);
        vig.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vig.addColorStop(1, 'rgba(2, 6, 18, 0.34)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
        ctx.restore();
    }

    function renderGame() {
        ctx.save();
        const totalScale = viewScale * dpr;
        ctx.scale(totalScale, totalScale);

        if (shakeFrames > 0) ctx.translate((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);

        drawBackground();
        drawFinishCastle();

        jumpPadsList.forEach(jp => {
            ctx.save(); ctx.fillStyle = '#10b981'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
            drawRoundRect(ctx, jp.x - 24, jp.y - 12, 48, 12, 6); ctx.fill(); ctx.stroke(); ctx.restore();
        });

        carrotsList.forEach(drawCarrotItem);
        powerupsList.forEach(drawPowerupItem);
        obstaclesList.forEach(drawObstacleItem);
        drawBossAndExtras();
        drawOnlineRivals();
        drawBunnyPlayer();

        particlesList.forEach(p => {
            ctx.save(); ctx.globalAlpha = Math.max(0, p.alpha); ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        });
        confettiList.forEach(cf => {
            ctx.save(); ctx.translate(cf.x, cf.y); ctx.rotate(cf.rot); ctx.fillStyle = cf.color;
            ctx.fillRect(-cf.w / 2, -cf.h / 2, cf.w, cf.h); ctx.restore();
        });
        floatingTexts.forEach(ft => {
            ctx.save(); ctx.globalAlpha = Math.max(0, ft.alpha);
            ctx.font = `900 ${ft.size}px 'Cairo', sans-serif`;
            ctx.fillStyle = ft.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.textAlign = 'center';
            ctx.strokeText(ft.text, ft.x, ft.y); ctx.fillText(ft.text, ft.x, ft.y); ctx.restore();
        });

        draw5DForegroundEffects();

        ctx.restore();
    }

    function gameLoop() {
        if (state === 'PLAYING') {
            updateGame();
        } else {
            frameCount++;
            player.runCycle += 0.08;
            player.earBounce = Math.sin(player.runCycle * 2) * 4;
        }
        renderGame();
        requestAnimationFrame(gameLoop);
    }

    // ==================== 12. CONTROLS & BUTTON BINDINGS ====================
    document.getElementById('btn-play').addEventListener('click', () => {
        if (selectedPlayMode === 'endless') startEndlessMode();
        else if (selectedPlayMode === 'boss') startBossArena();
        else if (selectedPlayMode === 'devil') startDevilLevel(selectedDevilLevelId);
        else startLevel(selectedLevelId);
    });
    document.getElementById('btn-replay-intro').addEventListener('click', () => openIntroScreen());

    document.getElementById('btn-logout').addEventListener('click', () => {
        if (serverOnline && currentUser && currentUser.token) {
            apiCall('logout', { token: currentUser.token }).catch(() => {});
        }
        currentUser = null;
        saveSession();
        showOnlyScreen('auth');
    });

    function toggleMute() {
        isMuted = !isMuted;
        const ico = isMuted ? '🔇' : '🔊';
        document.getElementById('btn-mute').textContent = ico;
        document.getElementById('btn-hub-mute').textContent = ico;
        if (isMuted) stopBGM(); else if (state === 'PLAYING') startBGM();
    }
    document.getElementById('btn-mute').addEventListener('click', toggleMute);
    document.getElementById('btn-hub-mute').addEventListener('click', toggleMute);

    function toggleBGM() {
        bgmEnabled = !bgmEnabled;
        const ico = bgmEnabled ? '🎵' : '🔕';
        document.getElementById('btn-bgm').textContent = ico;
        document.getElementById('btn-hub-bgm').textContent = ico;
        document.getElementById('btn-bgm').classList.toggle('muted-off', !bgmEnabled);
        document.getElementById('btn-hub-bgm').classList.toggle('muted-off', !bgmEnabled);
        if (!bgmEnabled) stopBGM(); else if (state === 'PLAYING') startBGM();
    }
    document.getElementById('btn-bgm').addEventListener('click', toggleBGM);
    document.getElementById('btn-hub-bgm').addEventListener('click', toggleBGM);

    function cyclePlayStyle() {
        const idx = PLAY_STYLES_DATA.findIndex(s => s.id === getActivePlayStyle());
        const next = PLAY_STYLES_DATA[(idx + 1) % PLAY_STYLES_DATA.length];
        setPlayStyle(next.id, true);
    }

    document.getElementById('btn-pause').addEventListener('click', () => {
        if (state !== 'PLAYING') return;
        state = 'PAUSED';
        jetpackHoldUp = false;
        jetpackHoldDown = false;
        stopBGM();
        syncPlayStyleUI();
        document.getElementById('pause-sub').textContent = `${activeLevel.name} • جمعتي ${levelCarrots} 🥕`;
        showOnlyScreen('pause');
    });
    document.getElementById('btn-resume').addEventListener('click', () => {
        state = 'PLAYING';
        showOnlyScreen(null);
        startBGM();
    });
    function restartActiveRun() {
        if (gameMode === 'endless') startEndlessMode();
        else if (gameMode === 'boss') startBossArena();
        else if (gameMode === 'devil') startDevilLevel(activeLevel.id);
        else if (gameMode === 'online') { openHomeScreen(); switchHubTab('online'); }
        else startLevel(activeLevel.id);
    }
    document.getElementById('btn-restart').addEventListener('click', restartActiveRun);
    document.getElementById('btn-quit').addEventListener('click', () => { syncProgress(); openHomeScreen(); });

    document.getElementById('btn-next').addEventListener('click', () => {
        if (gameMode === 'devil') startDevilLevel(Math.min(TOTAL_DEVIL_LEVELS, activeLevel.id + 1));
        else startLevel(Math.min(TOTAL_LEVELS, activeLevel.id + 1));
    });
    document.getElementById('btn-retry').addEventListener('click', restartActiveRun);
    document.getElementById('btn-home').addEventListener('click', () => openHomeScreen());

    document.getElementById('btn-hud-ult').addEventListener('click', (e) => { e.stopPropagation(); player.activateUltimate(); });
    document.getElementById('btn-hud-style').addEventListener('click', (e) => { e.stopPropagation(); cyclePlayStyle(); });

    document.querySelectorAll('#hud-emotes .emote-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const em = btn.getAttribute('data-emote');
            playerEmote = em;
            playerEmoteTimer = 95;
            pendingEmoteToSend = em;
            sfxCarrot(4);
        });
    });

    document.getElementById('btn-fullscreen').addEventListener('click', () => {
        const docEl = document.documentElement;
        const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (req) req.call(docEl).catch(() => {});
        } else {
            if (exit) exit.call(document).catch(() => {});
        }
    });

    window.addEventListener('keydown', (e) => {
        if (state !== 'PLAYING') {
            if (e.code === 'Escape' && state === 'PAUSED') {
                state = 'PLAYING'; showOnlyScreen(null); startBGM();
            }
            return;
        }
        const ps = getActivePlayStyle();
        if (e.code === 'Space') {
            e.preventDefault();
            if (ps === 'lanes') player.laneHop();
            else {
                if (ps === 'jetpack') jetpackHoldUp = true;
                if (!e.repeat) player.jump();
            }
        } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
            e.preventDefault();
            if (ps === 'jetpack') jetpackHoldUp = true;
            if (!e.repeat) player.jump();
        } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
            e.preventDefault();
            if (ps === 'jetpack') jetpackHoldDown = true;
            if (!e.repeat) player.slide();
        } else if (e.code === 'AltLeft' || e.code === 'AltRight' || e.key === 'Alt' || e.code === 'KeyZ' || e.code === 'KeyX') {
            e.preventDefault(); player.dash();
        } else if (e.code === 'KeyE' || e.code === 'KeyF' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
            e.preventDefault(); player.activateUltimate();
        } else if (e.code === 'KeyG' && !e.repeat) {
            e.preventDefault(); cyclePlayStyle();
        } else if (e.code === 'Escape' || e.code === 'KeyP') {
            document.getElementById('btn-pause').click();
        }
    });

    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
            jetpackHoldUp = false;
        } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
            jetpackHoldDown = false;
        }
    });

    function bindTouchButton(id, onDown, onUp = null) {
        const btn = document.getElementById(id);
        if (!btn) return;
        let isDown = false;
        const press = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            if (isDown) return;
            isDown = true;
            btn.classList.add('is-down');
            unlockAudio();
            onDown();
        };
        const release = (e) => {
            if (e && e.cancelable) e.preventDefault();
            if (!isDown) return;
            isDown = false;
            btn.classList.remove('is-down');
            if (onUp) onUp();
        };
        btn.addEventListener('touchstart', press, { passive: false });
        ['touchend', 'touchcancel'].forEach(ev => btn.addEventListener(ev, release, { passive: false }));
        btn.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') press(e); });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => {
            btn.addEventListener(ev, (e) => { if (e.pointerType !== 'touch') release(e); });
        });
    }
    bindTouchButton('tc-jump', () => {
        if (getActivePlayStyle() === 'jetpack') jetpackHoldUp = true;
        player.jump();
    }, () => { jetpackHoldUp = false; });
    bindTouchButton('tc-slide', () => {
        if (getActivePlayStyle() === 'jetpack') jetpackHoldDown = true;
        player.slide();
    }, () => { jetpackHoldDown = false; });
    bindTouchButton('tc-dash', () => player.dash());
    bindTouchButton('tc-ult', () => player.activateUltimate());

    let touchStartX = 0, touchStartY = 0, gestureDone = false;
    canvas.addEventListener('touchstart', (e) => {
        const touches = e.targetTouches && e.targetTouches.length ? e.targetTouches : e.touches;
        if (state !== 'PLAYING' || !touches.length) return;
        touchStartX = touches[0].clientX; touchStartY = touches[0].clientY; gestureDone = false;
        if (getActivePlayStyle() === 'jetpack') {
            jetpackHoldUp = true;
            player.jump();
        }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
        const touches = e.targetTouches && e.targetTouches.length ? e.targetTouches : e.touches;
        if (state !== 'PLAYING' || gestureDone || !touches.length) return;
        const dx = touches[0].clientX - touchStartX, dy = touches[0].clientY - touchStartY;
        if (dy < -28 && Math.abs(dy) > Math.abs(dx)) { gestureDone = true; player.jump(); }
        else if (dy > 28 && Math.abs(dy) > Math.abs(dx)) { gestureDone = true; jetpackHoldUp = false; player.slide(); }
        else if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy)) { gestureDone = true; player.dash(); }
    }, { passive: true });
    canvas.addEventListener('touchend', () => {
        jetpackHoldUp = false;
        if (state === 'PLAYING' && !gestureDone) {
            const ps = getActivePlayStyle();
            if (ps === 'lanes') player.laneHop();
            else if (ps === 'runner') player.jump();
        }
    }, { passive: true });
    canvas.addEventListener('touchcancel', () => { jetpackHoldUp = false; }, { passive: true });
    canvas.addEventListener('pointerdown', (e) => {
        if (state === 'PLAYING' && e.pointerType === 'mouse') {
            const ps = getActivePlayStyle();
            if (ps === 'lanes') player.laneHop();
            else if (ps === 'jetpack') { jetpackHoldUp = true; player.jump(); }
            else player.jump();
        }
    });
    canvas.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse') jetpackHoldUp = false;
    });

    player.reset();
    requestAnimationFrame(gameLoop);
    bootSession();
})();
