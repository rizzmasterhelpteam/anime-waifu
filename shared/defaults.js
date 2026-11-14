(function (root) {
  "use strict";

  const SPRITE_POSES = {
    idle: {
      id: "idle",
      label: "Idle",
      file: "assets/sprites/idle.png",
      shortDesc: "Poised & waiting"
    },
    wave: {
      id: "wave",
      label: "Wave",
      file: "assets/sprites/wave.png",
      shortDesc: "Warm greeting"
    },
    think: {
      id: "think",
      label: "Thinking",
      file: "assets/sprites/think.png",
      shortDesc: "Focused & curious"
    },
    celebrate: {
      id: "celebrate",
      label: "Celebrate",
      file: "assets/sprites/celebrate.png",
      shortDesc: "Cheering you on"
    },
    tea: {
      id: "tea",
      label: "Tea Break",
      file: "assets/sprites/tea.png",
      shortDesc: "Relaxed break"
    }
  };

  const WALK_SPRITES = {
    walk_left: "assets/sprites/walk_left.png"
  };

  const EXTRA_SPRITES = {
    idle_blink: "assets/sprites/idle_blink.png",
    wave_alt: "assets/sprites/wave_alt.png",
    tea_sip: "assets/sprites/tea_sip.png"
  };

  const ALL_SPRITE_FILES = Object.assign(
    {},
    Object.fromEntries(Object.entries(SPRITE_POSES).map(([id, entry]) => [id, entry.file])),
    WALK_SPRITES,
    EXTRA_SPRITES
  );

  function getSpriteFiles(modelKey = "seraphina") {
    const isCrimson = modelKey === "gothic_red" || modelKey === "crimson";
    const prefix = isCrimson ? "assets/sprites/crimson/" : "assets/sprites/";
    return {
      idle: `${prefix}idle.png`,
      wave: `${prefix}wave.png`,
      think: `${prefix}think.png`,
      celebrate: `${prefix}celebrate.png`,
      tea: `${prefix}tea.png`,
      walk_left: `${prefix}walk_left.png`,
      walk_pass_left: `${prefix}walk_pass_left.png`,
      walk_contact_right: `${prefix}walk_contact_right.png`,
      walk_pass_right: `${prefix}walk_pass_right.png`,
      idle_blink: `${prefix}idle_blink.png`,
      wave_alt: `${prefix}wave_alt.png`,
      tea_sip: `${prefix}tea_sip.png`
    };
  }

  const MOTION_IDS = ["idle", "wave", "think", "celebrate", "tea"];
  const MAX_MOTION_BUBBLES = 10;

  const DEFAULT_MOTION_QUOTES = {
    idle: [
      "Take your time, I'm right here beside you.",
      "Looking sharp today~ Keep up the momentum!",
      "Everything's running smooth. What are we tackling next?",
      "Tap me anytime if you want to switch my vibe~"
    ],
    wave: [
      "Hey there~ Ready to make today count?",
      "Hi hi! Good to see you here~",
      "Waving hi from your corner of the screen!",
      "Need a hand or just some cheerful company?"
    ],
    think: [
      "Hmm... interesting! Let's stay sharp and focus.",
      "Deep focus mode looks great on you.",
      "One step at a time—you've got this.",
      "Connecting the dots... keep that steady flow going~"
    ],
    celebrate: [
      "Nicely done! Time to celebrate that win!",
      "Awesome work! I knew you'd pull it off~",
      "Woohoo! You're on a roll right now!",
      "Victory vibes~ You earned a big smile!"
    ],
    tea: [
      "Sip slowly and rest your eyes for a minute.",
      "Tea break time~ Stretch your shoulders a little!",
      "Even the brightest minds need a calm breather.",
      "Warm cup, calm mind—no rush at all~"
    ]
  };

  function normalizeMotionQuotes(rawMotionQuotes, legacyCustomQuotes) {
    const out = {};
    const hasMotionObj = rawMotionQuotes && typeof rawMotionQuotes === "object" && !Array.isArray(rawMotionQuotes);
    for (const id of MOTION_IDS) {
      if (hasMotionObj && Array.isArray(rawMotionQuotes[id])) {
        out[id] = rawMotionQuotes[id]
          .map((q) => (typeof q === "string" ? q.trim().slice(0, 140) : ""))
          .filter(Boolean)
          .slice(0, MAX_MOTION_BUBBLES);
      } else {
        const base = [...DEFAULT_MOTION_QUOTES[id]];
        if (!hasMotionObj && id === "idle" && Array.isArray(legacyCustomQuotes) && legacyCustomQuotes.length > 0) {
          for (const q of legacyCustomQuotes) {
            const clean = typeof q === "string" ? q.trim().slice(0, 140) : "";
            if (clean && !base.includes(clean) && base.length < MAX_MOTION_BUBBLES) {
              base.push(clean);
            }
          }
        }
        out[id] = base.slice(0, MAX_MOTION_BUBBLES);
      }
    }
    return out;
  }

  const DEFAULT_QUOTES = {
    greeting: [...DEFAULT_MOTION_QUOTES.wave],
    idle: [...DEFAULT_MOTION_QUOTES.idle],
    wave: [...DEFAULT_MOTION_QUOTES.wave],
    think: [...DEFAULT_MOTION_QUOTES.think],
    celebrate: [...DEFAULT_MOTION_QUOTES.celebrate],
    tea: [...DEFAULT_MOTION_QUOTES.tea],
    wellness: [
      "Time for a sip of water and a 20-second eye rest~",
      "Look away from the screen for 20 seconds and hydrate!",
      "Quick tea break nudge: drop your shoulders and take a sip."
    ],
    returnTab: [
      "Welcome back to this tab~ Pick up right where you left off.",
      "Oh, you returned! Glad to see this tab again~",
      "Back for round two? I kept your seat warm."
    ],
    pat: [
      "Hehe~ double-tap cheer! You've got great energy today!",
      "Yay~ sending an extra boost of good luck your way!",
      "Aw, thanks for the attention! Let's crush it together~"
    ],
    readFinish: [
      "Made it all the way to the end! Nicely done~",
      "Finished reading that whole page! Need a breather?"
    ],
    morning: [
      "Good morning~ Fresh tab, fresh start!",
      "Morning sunshine! Ready for a calm, productive start?"
    ],
    afternoon: [
      "Good afternoon~ Keep that steady afternoon flow going!",
      "Halfway through the day—remember to stay hydrated~"
    ],
    evening: [
      "Good evening~ Smooth focus as the day winds down.",
      "Evening check-in! Take things at a comfortable pace~"
    ],
    lateNight: [
      "Burning the midnight oil? Don't push yourself too hard~",
      "Late-night browsing! Wrap up one goal and get good rest soon."
    ]
  };

  const WORK_DOMAINS = [
    "github.com",
    "gitlab.com",
    "stackoverflow.com",
    "docs.google.com",
    "sheets.google.com",
    "slides.google.com",
    "drive.google.com",
    "notion.so",
    "linear.app",
    "figma.com",
    "leetcode.com",
    "vercel.com",
    "developer.mozilla.org",
    "localhost"
  ];

  const RELAX_DOMAINS = [
    "youtube.com",
    "twitch.tv",
    "reddit.com",
    "netflix.com",
    "spotify.com",
    "x.com",
    "twitter.com",
    "instagram.com",
    "crunchyroll.com"
  ];

  function classifyDomain(hostname) {
    const host = String(hostname || "").toLowerCase();
    if (!host) return "general";
    if (WORK_DOMAINS.some((d) => host === d || host.endsWith("." + d))) return "work";
    if (RELAX_DOMAINS.some((d) => host === d || host.endsWith("." + d))) return "relax";
    return "general";
  }

  function getTimePeriodCategory(hour = new Date().getHours()) {
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 17) return "afternoon";
    if (hour >= 17 && hour < 23) return "evening";
    return "lateNight";
  }

  const TAB_WATCH_APPS = {
    claude: {
      id: "claude",
      label: "Claude",
      desc: "Done generating",
      mode: "ai_stream",
      hosts: ["claude.ai"]
    },
    chatgpt: {
      id: "chatgpt",
      label: "ChatGPT / Codex",
      desc: "Done generating",
      mode: "ai_stream",
      hosts: ["chatgpt.com", "chat.openai.com"]
    },
    gemini: {
      id: "gemini",
      label: "Gemini",
      desc: "Done generating",
      mode: "ai_stream",
      hosts: ["gemini.google.com"]
    },
    gmail: {
      id: "gmail",
      label: "Gmail",
      desc: "Unread (N)",
      mode: "title_count",
      hosts: ["mail.google.com"]
    },
    whatsapp: {
      id: "whatsapp",
      label: "WhatsApp Web",
      desc: "Unread (N)",
      mode: "title_count",
      hosts: ["web.whatsapp.com"]
    },
    discord: {
      id: "discord",
      label: "Discord",
      desc: "Unread (N)",
      mode: "title_count",
      hosts: ["discord.com"]
    },
    github: {
      id: "github",
      label: "GitHub",
      desc: "Notifications (N)",
      mode: "title_count",
      hosts: ["github.com"]
    },
    youtube: {
      id: "youtube",
      label: "YouTube",
      desc: "Alerts (N)",
      mode: "title_count",
      hosts: ["www.youtube.com", "youtube.com"]
    }
  };

  function matchWatchApp(hostname, customDomains = []) {
    const host = String(hostname || "").toLowerCase();
    if (!host) return null;
    for (const app of Object.values(TAB_WATCH_APPS)) {
      if (app.hosts.some((h) => host === h || host.endsWith("." + h))) {
        return app;
      }
    }
    if (Array.isArray(customDomains)) {
      for (const raw of customDomains) {
        const domain = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
        if (domain && (host === domain || host.endsWith("." + domain))) {
          return {
            id: `custom:${domain}`,
            label: domain,
            desc: "Unread (N)",
            mode: "title_count",
            isCustom: true,
            hosts: [domain]
          };
        }
      }
    }
    return null;
  }

  function parseTitleUnreadCount(title) {
    const str = String(title || "");
    const m = str.match(/(?:^|\s)[\(\[](\d{1,3})[\)\]](?=\s|$)/);
    if (!m) return 0;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  const DEFAULT_SETTINGS = {
    enabled: true,
    name: "Seraphina",
    renderMode: "3d", // "3d" | "2d"
    modelSource: "auto", // "auto" | "custom" | "starter"
    activeModel: "seraphina", // "seraphina" | "gothic_red"
    modelName: "",
    modelVersion: 2,
    poseMode: "auto", // "auto" | "idle" | "wave" | "think" | "celebrate" | "tea"
    sizePx: 280,
    opacity: 1.0,
    microMotion: true,
    bodyPhysics: true,
    physicsStrength: 90,
    chestBounce: 100,
    depth25D: true,
    autoStroll: true,
    smartRoles: true,
    interactionFrequency: "playful",
    wellnessReminder: true,
    showBubbles: true,
    greetOnLoad: true,
    cursorFollow: true,
    showInFullscreen: true,
    tabAlerts: {
      enabled: true,
      pose: "celebrate", // "celebrate" | "wave" | "tea" | "think"
      apps: {
        claude: true,
        chatgpt: true,
        gemini: true,
        gmail: true,
        whatsapp: true,
        discord: true,
        github: false,
        youtube: false
      },
      customDomains: []
    },
    position: {
      right: 24,
      bottom: 18
    },
    hiddenDomains: [],
    motionQuotes: normalizeMotionQuotes(null)
  };

  const DEFAULT_TIMER = {
    status: "idle", // "idle" | "running" | "paused"
    phase: "focus", // "focus" | "break"
    focusMinutes: 25,
    breakMinutes: 5,
    remainingSeconds: 25 * 60,
    targetEndMs: null
  };

  const DEFAULT_STATS = {
    dateKey: "",
    focusSessionsToday: 0,
    cheerCount: 0
  };

  // Event-driven personality state, shared by sprite and VRM renderers.
  class CompanionBrain {
    constructor(random = Math.random) { this.random=random; this.stage=0; this.elapsed=0; this.last=0; this.lastTouch=-Infinity; this.ignoreUntil=0; this.next=90000+random()*30000; }
    tick(now, paused=false, frequency='balanced') {
      const dt=this.last ? Math.max(0,Math.min(2500,now-this.last)) : 0; this.last=now;
      if(paused || frequency==='quiet') return null;
      this.elapsed+=dt;
      if(this.elapsed<this.next) return null;
      this.elapsed=0; this.stage=(this.stage+1)%5;
      this.next=this.stage===4 ? 240000+this.random()*120000 : 90000+this.random()*30000;
      if(frequency==='playful') this.next=Math.max(90000,this.next*.85);
      return ['relax','garden','dance','pout','rest'][this.stage];
    }
    touch(now, crimson=false) {
      if(now-this.lastTouch<1800 || now<this.ignoreUntil) return null;
      this.lastTouch=now;
      if(this.stage===3){this.stage=4;this.elapsed=0;this.next=90000+this.random()*30000;this.ignoreUntil=now+(crimson?5500:2800);return 'sidestep';}
      const wasGarden=this.stage===1;
      this.elapsed=0; this.stage=wasGarden?1:0; this.next=90000+this.random()*30000;
      return wasGarden?'showPlant':'greet';
    }
  }

  // Internal activity rarity; never exposed as dashboard settings.
  class ActivityDirector {
    constructor(random=Math.random,now=0){this.random=random;this.nextAt=now+3000;this.lastAt={};this.last=null;}
    defer(now){this.nextAt=now+3000+this.random()*3000;}
    pick(now,walkAllowed=true){
      const entries=[['walk',70,0],['dance',15,45000],['garden',10,60000],['rest',5,90000]]
        .filter(([id,,cooldown])=>(id!=='walk'||walkAllowed)&&now-(this.lastAt[id]??-Infinity)>=cooldown&&(id==='walk'||id!==this.last));
      const total=entries.reduce((sum,e)=>sum+e[1],0);if(!total)return null;
      let roll=this.random()*total;
      for(const [id,weight]of entries){roll-=weight;if(roll<0){this.last=id;this.lastAt[id]=now;return id;}}
      return entries[entries.length-1][0];
    }
  }

  function wanderDestination(position,width,height,size,random=Math.random){
    const maxRight=Math.max(8,width-Math.round(size*460/600)-8),maxBottom=Math.max(8,height-size-8);
    let best={right:8,bottom:8},bestDistance=-1;
    // Sample the whole available viewport, favouring a meaningful journey.
    for(let i=0;i<5;i++){
      const point={right:8+random()*(maxRight-8),bottom:8+random()*(maxBottom-8)};
      const distance=Math.hypot(point.right-position.right,point.bottom-position.bottom);
      if(distance>bestDistance){best=point;bestDistance=distance;}
      if(distance>=Math.min(220,size*.8))return point;
    }
    return best;
  }

  function behaviorMotion(behavior, now) {
    const zero={x:0,y:0,roll:0,turn:0,bend:0,arm:0,weight:0};
    if(!behavior || now>=behavior.until) return zero;
    const t=Math.max(0,(now-behavior.start)/1000), remaining=(behavior.until-now)/1000;
    const weight=Math.min(1,t/.6,remaining/.6), lively=behavior.crimson?1.25:0.8;
    const m={...zero,weight};
    if(behavior.id==='dance'){m.x=Math.sin(t*3.8)*.025*lively;m.y=-Math.pow(Math.sin(t*3.8),2)*.012;m.roll=Math.sin(t*3.8)*.065*lively;m.arm=(.5+.5*Math.sin(t*3.8))*.65;m.turn=Math.sin(t*1.9)*.18;}
    if(behavior.id==='garden'||behavior.id==='showPlant'){m.bend=.14+Math.sin(t*1.8)*.035;m.roll=Math.sin(t*1.8)*.014;m.arm=.35+Math.sin(t*1.8)*.10;}
    if(behavior.id==='pout'||behavior.id==='sidestep'){m.turn=(behavior.crimson?.6:.25);m.roll=behavior.crimson?-.035:.025;m.arm=-.45;}
    if(behavior.id==='rest'){m.bend=.045;m.roll=Math.sin(t*.8)*.015;}
    for(const key of ['x','y','roll','turn','bend','arm'])m[key]*=weight;
    return m;
  }

  root.WAIFU_SHARED = {
    CompanionBrain,
    ActivityDirector,
    wanderDestination,
    behaviorMotion,
    SPRITE_POSES,
    WALK_SPRITES,
    EXTRA_SPRITES,
    ALL_SPRITE_FILES,
    getSpriteFiles,
    MOTION_IDS,
    MAX_MOTION_BUBBLES,
    DEFAULT_MOTION_QUOTES,
    normalizeMotionQuotes,
    DEFAULT_QUOTES,
    DEFAULT_SETTINGS,
    DEFAULT_TIMER,
    DEFAULT_STATS,
    TAB_WATCH_APPS,
    classifyDomain,
    getTimePeriodCategory,
    matchWatchApp,
    parseTitleUnreadCount
  };
})(typeof globalThis !== "undefined" ? globalThis : self);

