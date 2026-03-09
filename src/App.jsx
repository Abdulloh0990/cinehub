import React, {
  useState, useEffect, useRef, useMemo, useCallback, memo
} from 'react';

/* ═══════════════════════════════════════════════
   SUPABASE CONFIG
═══════════════════════════════════════════════ */
const CFG_KEY  = 'cinehub_sb_cfg';
const SESS_KEY = 'cinehub_session';
const SAVE_DELAY = 2000;
const PER_PAGE   = 24;
const TMDB_KEY  = '9a0958e65913cb6442245e147254971f';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG  = 'https://image.tmdb.org/t/p';
const KODIK_TOKEN = '447d179e875efe44217f20d1ee2146be';
const KODIK_API = 'https://kodikapi.com';

const TMDB_GENRE_MAP = {
  28:'action', 12:'adventure', 16:'animation', 35:'comedy', 80:'crime',
  99:'documentary', 18:'drama', 10751:'adventure', 14:'fantasy', 36:'history',
  27:'horror', 10402:'musical', 9648:'mystery', 10749:'romance', 878:'sci-fi',
  53:'thriller', 10752:'war', 37:'western',
};

const GENRE_TO_TMDB = {
  action:28, adventure:12, animation:16, comedy:35, crime:80,
  documentary:99, drama:18, fantasy:14, history:36, horror:27,
  musical:10402, mystery:9648, romance:10749, 'sci-fi':878,
  thriller:53, war:10752, western:37,
};

const toTmdbLang = (l) => l === 'en' ? 'en-US' : l === 'ru' ? 'ru-RU' : 'ru-RU';

function normalizeTMDB(m) {
  const year = m.release_date ? parseInt(m.release_date.slice(0, 4)) : null;
  const genres = (m.genre_ids ?? m.genres?.map(g => g.id) ?? [])
    .map(id => TMDB_GENRE_MAP[id]).filter(Boolean);
  return {
    id:               `tmdb_${m.id}`,
    tmdb_id:          m.id,
    imdb_code:        m.imdb_id ?? null,
    title:            m.title ?? m.original_title ?? '',
    year,
    rating:           m.vote_average ? parseFloat(m.vote_average.toFixed(1)) : 0,
    runtime:          m.runtime ?? 0,
    language:         m.original_language ?? 'en',
    genres,
    description_full: m.overview ?? '',
    summary:          m.overview ?? '',
    medium_cover_image:        m.poster_path  ? `${TMDB_IMG}/w400${m.poster_path}`  : '',
    large_cover_image:         m.poster_path  ? `${TMDB_IMG}/w780${m.poster_path}`  : '',
    background_image_original: m.backdrop_path? `${TMDB_IMG}/original${m.backdrop_path}`:'',
    background_image:          m.backdrop_path? `${TMDB_IMG}/w1280${m.backdrop_path}`:'',
    torrents: [],
    _source: 'tmdb',
  };
}

const apiCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function tmdbFetch(path, lang = 'en') {
  const key = `${path}|${lang}`;
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
  try {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${TMDB_BASE}${path}${sep}api_key=${TMDB_KEY}&language=${toTmdbLang(lang)}`;
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 8000);
    const r    = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    const d = await r.json();
    apiCache.set(key, { data:d, ts:Date.now() });
    return d;
  } catch { return null; }
}

const imdbCache = new Map();
async function getImdbId(tmdbId) {
  if (imdbCache.has(tmdbId)) return imdbCache.get(tmdbId);
  try {
    const d = await fetch(`${TMDB_BASE}/movie/${tmdbId}/external_ids?api_key=${TMDB_KEY}`).then(r => r.json());
    const id = d?.imdb_id ?? null;
    imdbCache.set(tmdbId, id);
    return id;
  } catch { return null; }
}

/* ── Kodik: fetch ALL translations for a movie ── */
const kodikCache = new Map();
async function kodikSearchAll(imdbId, tmdbId) {
  const cacheKey = `${imdbId ?? ''}_${tmdbId ?? ''}`;
  if (kodikCache.has(cacheKey)) return kodikCache.get(cacheKey);
  try {
    const queries = [];
    if (imdbId) queries.push(fetch(`${KODIK_API}/search?token=${KODIK_TOKEN}&imdb_id=${imdbId}&with_material_data=true&limit=100`).then(r=>r.json()).catch(()=>null));
    if (tmdbId)  queries.push(fetch(`${KODIK_API}/search?token=${KODIK_TOKEN}&kinopoisk_id=${tmdbId}&with_material_data=true&limit=100`).then(r=>r.json()).catch(()=>null));
    const results = await Promise.all(queries);
    const seen = new Set();
    const items = [];
    for (const d of results) {
      for (const r of (d?.results ?? [])) {
        const key = r.translation?.id ?? r.link;
        if (!seen.has(key)) { seen.add(key); items.push(r); }
      }
    }
    kodikCache.set(cacheKey, items);
    setTimeout(() => kodikCache.delete(cacheKey), CACHE_TTL);
    return items;
  } catch { return []; }
}

const imgCache = new Set();
const preloadImg = (src) => {
  if (!src || imgCache.has(src)) return;
  imgCache.add(src);
  const img = new Image(); img.src = src;
};

const DEFAULT_CFG = {
  url: 'https://msnbflkjawfyffxpjiiy.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zbmJmbGtqYXdmeWZmeHBqaWl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDYwNzYsImV4cCI6MjA4ODM4MjA3Nn0.jxXVjvmR9x3kfNXYRGzP2ZkfEj6NOVzv_jv1m2XeAik',
};
const loadCfg = () => { try { const v = localStorage.getItem(CFG_KEY); return v ? JSON.parse(v) : DEFAULT_CFG; } catch { return DEFAULT_CFG; } };
const saveCfg = (c) => { try { if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY); } catch {} };

const mkSB = (url, key) => ({
  async signUp(email, password, name) {
    const r = await fetch(`${url}/auth/v1/signup`, { method:'POST', headers:{ 'Content-Type':'application/json', apikey:key, Authorization:`Bearer ${key}` }, body:JSON.stringify({ email, password, data:{ display_name:name } }) });
    return r.json();
  },
  async signIn(email, password) {
    const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method:'POST', headers:{ 'Content-Type':'application/json', apikey:key, Authorization:`Bearer ${key}` }, body:JSON.stringify({ email, password }) });
    return r.json();
  },
  async signOut(token) { await fetch(`${url}/auth/v1/logout`, { method:'POST', headers:{ apikey:key, Authorization:`Bearer ${token}` } }); },
  async refreshToken(refresh_token) {
    const r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, { method:'POST', headers:{ 'Content-Type':'application/json', apikey:key, Authorization:`Bearer ${key}` }, body:JSON.stringify({ refresh_token }) });
    return r.json();
  },
  async getData(token, uid) {
    const r = await fetch(`${url}/rest/v1/cinehub_data?user_id=eq.${uid}&select=*`, { headers:{ apikey:key, Authorization:`Bearer ${token}` } });
    const d = await r.json(); return Array.isArray(d) && d.length > 0 ? d[0].data : null;
  },
  async upsertData(token, uid, data) {
    const r = await fetch(`${url}/rest/v1/cinehub_data`, { method:'POST', headers:{ 'Content-Type':'application/json', apikey:key, Authorization:`Bearer ${token}`, Prefer:'resolution=merge-duplicates' }, body:JSON.stringify({ user_id:uid, data, updated_at:new Date().toISOString() }) });
    return r.ok;
  },
});

const LS = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
  json: k => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
};

/* ═══════════════════════════════════════════════
   PLAYER SOURCES
═══════════════════════════════════════════════ */
const PLAYERS = [
  { id:'kodik',   n:'Kodik',       kodik:true,  url: () => null },
  { id:'vidsrc',  n:'VidSrc',      kodik:false, url: (imdb, tmdb) => `https://vidsrc.pro/embed/movie/${tmdb}` },
  { id:'vicu',    n:'VidSrc.icu',  kodik:false, url: (imdb, tmdb) => `https://vidsrc.icu/embed/movie/${imdb ?? tmdb}` },
  { id:'videasy', n:'Videasy',     kodik:false, url: (imdb, tmdb) => `https://player.videasy.net/movie/${tmdb}` },
  { id:'embedsu', n:'Embed.su',    kodik:false, url: (imdb, tmdb) => `https://embed.su/embed/movie/${imdb ?? tmdb}` },
  { id:'2embed',  n:'2Embed',      kodik:false, url: (imdb, tmdb) => `https://www.2embed.cc/embed/${imdb ?? tmdb}` },
];

/* ── Language flags / labels ── */
const LANG_META = {
  'Русский':      { flag:'🇷🇺', short:'RU' },
  'Украинский':   { flag:'🇺🇦', short:'UA' },
  'English':      { flag:'🇬🇧', short:'EN' },
  'Английский':   { flag:'🇬🇧', short:'EN' },
  'Турецкий':     { flag:'🇹🇷', short:'TR' },
  'Казахский':    { flag:'🇰🇿', short:'KZ' },
  'Узбекский':    { flag:'🇺🇿', short:'UZ' },
  'Таджикский':   { flag:'🇹🇯', short:'TJ' },
  'Азербайджанский':{ flag:'🇦🇿', short:'AZ' },
};

/* ═══════════════════════════════════════════════
   THEMES
═══════════════════════════════════════════════ */
const THEMES = {
  noir:    { n:'Noir',    i:'🎬', p:'#e2e8f0', s:'#94a3b8', b:'#050507', m:'#0a0a0f' },
  crimson: { n:'Crimson', i:'🔴', p:'#f43f5e', s:'#e11d48', b:'#0d0306', m:'#140508' },
  cobalt:  { n:'Cobalt',  i:'🔵', p:'#3b82f6', s:'#1d4ed8', b:'#030610', m:'#060c1a' },
  violet:  { n:'Violet',  i:'💜', p:'#a855f7', s:'#7c3aed', b:'#07030e', m:'#0e0618' },
  amber:   { n:'Amber',   i:'🟡', p:'#f59e0b', s:'#d97706', b:'#0d0800', m:'#160f00' },
  emerald: { n:'Emerald', i:'💚', p:'#10b981', s:'#059669', b:'#020d08', m:'#041410' },
  rose:    { n:'Rose',    i:'🌹', p:'#fb7185', s:'#f43f5e', b:'#0d0408', m:'#15060c' },
  gold:    { n:'Gold',    i:'✨', p:'#eab308', s:'#ca8a04', b:'#0c0a00', m:'#141200' },
};

const GENRES = [
  { id:'action',       e:'⚡', uz:"Jangovar",   ru:'Боевик',        en:'Action'      },
  { id:'comedy',       e:'😂', uz:"Komediya",   ru:'Комедия',       en:'Comedy'      },
  { id:'drama',        e:'🎭', uz:"Drama",      ru:'Драма',         en:'Drama'       },
  { id:'horror',       e:'👻', uz:"Qoʻrqinch",  ru:'Ужасы',         en:'Horror'      },
  { id:'thriller',     e:'🔪', uz:"Triller",    ru:'Триллер',       en:'Thriller'    },
  { id:'sci-fi',       e:'🚀', uz:"Ilmiy",      ru:'Фantastika',    en:'Sci-Fi'      },
  { id:'animation',    e:'🎨', uz:"Multfilm",   ru:'Анимация',      en:'Animation'   },
  { id:'romance',      e:'❤️', uz:"Sevgi",      ru:'Мелодрама',     en:'Romance'     },
  { id:'crime',        e:'🕵️', uz:"Jinoyat",    ru:'Криминал',      en:'Crime'       },
  { id:'adventure',    e:'🗺️', uz:"Sarguzasht", ru:'Приключения',   en:'Adventure'   },
  { id:'fantasy',      e:'🧙', uz:"Fantastika", ru:'Фэнтези',       en:'Fantasy'     },
  { id:'biography',    e:'📖', uz:"Biografiya", ru:'Биография',     en:'Biography'   },
  { id:'history',      e:'🏛️', uz:"Tarixiy",    ru:'Исторический',  en:'History'     },
  { id:'western',      e:'🤠', uz:"Western",    ru:'Вестерн',       en:'Western'     },
  { id:'war',          e:'🪖', uz:"Urush",      ru:'Военный',       en:'War'         },
  { id:'documentary',  e:'🎥', uz:"Hujjatli",   ru:'Документальный',en:'Documentary' },
  { id:'mystery',      e:'🔮', uz:"Sirli",      ru:'Детектив',      en:'Mystery'     },
  { id:'musical',      e:'🎵', uz:"Musical",    ru:'Мюзикл',        en:'Musical'     },
];

const T = {
  home:     { uz:'Bosh sahifa', ru:'Главная',    en:'Home'      },
  browse:   { uz:'Katalog',     ru:'Каталог',    en:'Browse'    },
  favs:     { uz:'Sevimlilar',  ru:'Избранное',  en:'Favorites' },
  watchlist:{ uz:'Roʻyxat',     ru:'Список',     en:'Watchlist' },
  library:  { uz:'Kutubxona',   ru:'Библиотека', en:'Library'   },
  history:  { uz:'Tarix',       ru:'История',    en:'History'   },
  stats:    { uz:'Statistika',  ru:'Статистика', en:'Stats'     },
  search:   { uz:'Qidirish',    ru:'Поиск',      en:'Search'    },
  popular:  { uz:'Mashhur',     ru:'Популярное', en:'Popular'   },
  topRated: { uz:'Top Reyting', ru:'Топ рейтинг',en:'Top Rated' },
  latest:   { uz:'Yangi',       ru:'Новинки',    en:'Latest'    },
  watch:    { uz:'Koʻrish',     ru:'Смотреть',   en:'Watch'     },
  login:    { uz:'Kirish',      ru:'Войти',      en:'Sign In'   },
  register: { uz:'Roʻyxatdan',  ru:'Регистрация',en:'Register'  },
  profile:  { uz:'Profil',      ru:'Профиль',    en:'Profile'   },
  settings: { uz:'Sozlamalar',  ru:'Настройки',  en:'Settings'  },
  logout:   { uz:'Chiqish',     ru:'Выйти',      en:'Sign Out'  },
  rating:   { uz:'Reyting',     ru:'Рейтинг',    en:'Rating'    },
  duration: { uz:'Davomiyligi', ru:'Длительность',en:'Duration' },
  synopsis: { uz:'Qisqacha',    ru:'Описание',   en:'Synopsis'  },
  filters:  { uz:'Filtrlar',    ru:'Фильтры',    en:'Filters'   },
  allGenres:{ uz:'Barcha janrlar',ru:'Все жанры',en:'All Genres'},
  minRating:{ uz:'Min reyting', ru:'Мин. рейтинг',en:'Min Rating'},
  year:     { uz:'Yil',         ru:'Год',        en:'Year'      },
  all:      { uz:'Barchasi',    ru:'Все',        en:'All'       },
  apply:    { uz:'Qoʻllash',    ru:'Применить',  en:'Apply'     },
  reset:    { uz:'Tozalash',    ru:'Сброс',      en:'Reset'     },
  watched:  { uz:'Koʻrildi',    ru:'Просмотрено',en:'Watched'   },
  watching: { uz:'Koʻrilmoqda', ru:'Смотрю',     en:'Watching'  },
  planned:  { uz:'Rejada',      ru:'В планах',   en:'Planned'   },
  addFav:   { uz:'Sevimliga',   ru:'В избранное',en:'Favorite'  },
  addList:  { uz:'Roʻyxatga',   ru:'В список',   en:'Watchlist' },
  notFound: { uz:'Topilmadi',   ru:'Не найдено', en:'Not found' },
  films:    { uz:'film',        ru:'фильмов',    en:'films'     },
  minutes:  { uz:'daqiqa',      ru:'мин',        en:'min'       },
  share:    { uz:'Ulashish',    ru:'Поделиться', en:'Share'     },
  note:     { uz:'Eslatma',     ru:'Заметка',    en:'Note'      },
  theme:    { uz:'Mavzu',       ru:'Тема',       en:'Theme'     },
  language: { uz:'Til',         ru:'Язык',       en:'Language'  },
  player:   { uz:'Pleyer',      ru:'Плеер',      en:'Player'    },
  yourRating:{ uz:'Sizning bahoyingiz',ru:'Ваша оценка',en:'Your rating'},
  achievements:{ uz:'Yutuqlar', ru:'Достижения', en:'Achievements'},
  completed:{ uz:'Tugatildi',   ru:'Завершено',  en:'Completed' },
  random:   { uz:'Tasodifiy',   ru:'Случайный',  en:'Random'    },
  export:   { uz:'Eksport',     ru:'Экспорт',    en:'Export'    },
  import:   { uz:'Import',      ru:'Импорт',     en:'Import'    },
  data:     { uz:'Malumotlar',  ru:'Данные',     en:'Data'      },
  name:     { uz:'Ism',         ru:'Имя',        en:'Name'      },
  bio:      { uz:'Haqida',      ru:'О себе',     en:'Bio'       },
  save:     { uz:'Saqlash',     ru:'Сохранить',  en:'Save'      },
  signInToUse:{ uz:'Kirish kerak',ru:'Требуется вход',en:'Sign in required'},
  level:    { uz:'Daraja',      ru:'Уровень',    en:'Level'     },
  prevPage: { uz:'Oldingi',     ru:'Назад',      en:'Prev'      },
  nextPage: { uz:'Keyingi',     ru:'Вперёд',     en:'Next'      },
  page:     { uz:'Bet',         ru:'Стр.',       en:'Page'      },
  dubbing:  { uz:'Ovoz berish', ru:'Озвучка',    en:'Dubbing'   },
  original: { uz:'Asl nusxa',   ru:'Оригинал',   en:'Original'  },
  noTrans:  { uz:'Tarjima topilmadi', ru:'Переводы не найдены', en:'No translations found' },
  loading:  { uz:'Yuklanmoqda…', ru:'Загрузка…', en:'Loading…'  },
  source:   { uz:'Manba',       ru:'Источник',   en:'Source'    },
  tryOther: { uz:'Boshqa manbani sinab koʻring', ru:'Попробуйте другой источник', en:'Try another source' },
  notAvail: { uz:'Kino topilmadi', ru:'Не найдено', en:'Not available' },
};

const RANKS = [
  { min:0,   l:{ uz:'Yangi',       ru:'Новичок',   en:'Newcomer'  }, c:'#64748b', b:'🌱' },
  { min:10,  l:{ uz:'Tomoshabin',  ru:'Зритель',   en:'Viewer'    }, c:'#3b82f6', b:'🎬' },
  { min:30,  l:{ uz:'Muxlis',      ru:'Ценитель',  en:'Fan'       }, c:'#a855f7', b:'💎' },
  { min:60,  l:{ uz:'Usta',        ru:'Мастер',    en:'Master'    }, c:'#f97316', b:'🔥' },
  { min:85,  l:{ uz:'Elita',       ru:'Элита',     en:'Elite'     }, c:'#ef4444', b:'👑' },
  { min:100, l:{ uz:'Legenda',     ru:'Легенда',   en:'Legend'    }, c:'#eab308', b:'⭐' },
];

const ACHS = [
  { id:'first',   n:{ uz:'Birinchi qadam', ru:'Первый шаг',   en:'First Step'    }, e:'🎬', xp:10  },
  { id:'rate10',  n:{ uz:'Tanqidchi',     ru:'Критик',       en:'Critic'        }, e:'⭐', xp:50  },
  { id:'comp50',  n:{ uz:'Marafon',       ru:'Марафонец',    en:'Marathoner'    }, e:'🏃', xp:100 },
  { id:'fav20',   n:{ uz:'Kollektsioner', ru:'Коллекционер', en:'Collector'     }, e:'❤️', xp:40  },
  { id:'night',   n:{ uz:'Tungi qoʻriqchi',ru:'Полуночник',  en:'Night Owl'     }, e:'🦉', xp:25  },
  { id:'notes10', n:{ uz:'Muharrir',      ru:'Рецензент',    en:'Reviewer'      }, e:'📝', xp:60  },
  { id:'lib100',  n:{ uz:'Arxivchi',      ru:'Архивист',     en:'Archivist'     }, e:'📚', xp:200 },
  { id:'share5',  n:{ uz:'Blogger',       ru:'Блогер',       en:'Blogger'       }, e:'📤', xp:20  },
  { id:'perf10',  n:{ uz:'Perfeksionist', ru:'Перфект',      en:'Perfectionist' }, e:'💯', xp:80  },
  { id:'genres5', n:{ uz:'Turli xil',     ru:'Всеядный',     en:'Versatile'     }, e:'🎭', xp:70  },
  { id:'search10',n:{ uz:'Qidiruvchi',    ru:'Следопыт',     en:'Seeker'        }, e:'🔍', xp:30  },
];

const t = (key, lang) => T[key]?.[lang] || T[key]?.en || key;
const getRank = xp => { const lv = Math.floor(xp / 100) + 1; return [...RANKS].reverse().find(r => lv >= r.min) ?? RANKS[0]; };
const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n ?? 0);
const today = () => new Date().toDateString();

const buildCSS = (p, s, b, m) => `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,700;1,9..40,400&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html{scroll-behavior:smooth;height:100%}
body{font-family:'DM Sans',system-ui,sans-serif;background:${b};color:#fff;overflow-x:hidden;min-height:100dvh}
:root{--p:${p};--s:${s};--base:${b};--mid:${m};--glass:rgba(255,255,255,.05);--gb:rgba(255,255,255,.09);--dim:rgba(255,255,255,.4);--r:14px;--card-bg:rgba(255,255,255,.04)}
img{user-select:none;-webkit-user-drag:none;display:block}
input,textarea,select,button{font-family:'DM Sans',system-ui,sans-serif}
a{color:inherit;text-decoration:none}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-thumb{background:${p}44;border-radius:99px}
.ns{scrollbar-width:none;-ms-overflow-style:none}
.ns::-webkit-scrollbar{display:none}

@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
@keyframes scaleIn{from{opacity:0;transform:scale(.88) translateY(14px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes pop{0%{opacity:0;transform:scale(.5) rotate(-12deg)}70%{transform:scale(1.06) rotate(2deg)}100%{opacity:1;transform:scale(1) rotate(0)}}
@keyframes shimmer{0%{background-position:-900px 0}100%{background-position:900px 0}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes glow{0%,100%{box-shadow:0 0 16px ${p}55,0 0 32px ${p}22}50%{box-shadow:0 0 28px ${p}99,0 0 56px ${p}44}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes toastIn{from{opacity:0;transform:translateX(32px) scale(.92)}to{opacity:1;transform:translateX(0) scale(1)}}
@keyframes heartPop{0%{transform:scale(1)}35%{transform:scale(1.55)}65%{transform:scale(.92)}100%{transform:scale(1)}}
@keyframes barFill{from{width:0}to{width:var(--bw,100%)}}
@keyframes marquee{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
@keyframes cardIn{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes imgFadeIn{from{opacity:0;transform:scale(1.04)}to{opacity:1;transform:scale(1)}}
@keyframes pageSlide{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}

.fu{animation:fadeUp .38s cubic-bezier(.4,0,.2,1) both}
.fi{animation:fadeIn .26s ease both}
.su{animation:slideUp .42s cubic-bezier(.34,1.1,.64,1) both}
.si{animation:scaleIn .34s cubic-bezier(.34,1.1,.64,1) both}
.ap{animation:pop .5s cubic-bezier(.34,1.56,.64,1) both}
.ps{animation:pageSlide .3s cubic-bezier(.4,0,.2,1) both}

.glass{background:var(--glass);backdrop-filter:blur(16px);border:1px solid var(--gb)}
.glass-dark{background:rgba(4,4,10,.97);backdrop-filter:blur(32px) saturate(180%);border:1px solid rgba(255,255,255,.09)}
.card{background:var(--card-bg);border:1px solid rgba(255,255,255,.07);border-radius:var(--r)}
.shimmer{background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.07) 50%,transparent 100%);background-size:900px 100%;animation:shimmer 1.6s ease infinite}
.btn-p{background:linear-gradient(135deg,${p},${s});color:#000;border:none;cursor:pointer;font-weight:700;transition:all .2s;font-family:'DM Sans',system-ui,sans-serif}
.btn-p:hover{filter:brightness(1.12);transform:translateY(-2px);box-shadow:0 10px 28px ${p}44}
.btn-p:active{transform:scale(.97)}
.btn-g{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.7);cursor:pointer;font-weight:600;transition:all .2s;font-family:'DM Sans',system-ui,sans-serif}
.btn-g:hover{background:rgba(255,255,255,.14)}
.inp{background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.1);color:#fff;outline:none;transition:all .22s;font-family:'DM Sans',system-ui,sans-serif;font-weight:500}
.inp:focus{border-color:${p}88;box-shadow:0 0 0 3px ${p}15;background:rgba(255,255,255,.1)}
.inp::placeholder{color:rgba(255,255,255,.25)}
.lc1{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.lc2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.lc3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}

input[type=range]{-webkit-appearance:none;height:5px;border-radius:99px;cursor:pointer;outline:none;border:none}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:white;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5);transition:transform .15s}
input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.25)}

.movie-card{cursor:pointer;border-radius:16px;overflow:hidden;position:relative;aspect-ratio:2/3;background:linear-gradient(135deg,${m},${b});transition:transform .3s cubic-bezier(.4,0,.2,1),box-shadow .3s ease;will-change:transform}
.movie-card:hover{transform:translateY(-8px) scale(1.03);box-shadow:0 24px 48px rgba(0,0,0,.7),0 0 0 1px ${p}44}
@media(hover:none){.movie-card:hover{transform:none;box-shadow:none}.movie-card:active{transform:scale(.96)}}

.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px;contain:layout}
@media(max-width:600px){.card-grid{grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:9px}}
@media(max-width:340px){.card-grid{grid-template-columns:repeat(2,1fr);gap:7px}}

.sidebar{display:none!important}
@media(min-width:1024px){.sidebar{display:block!important}}
.desk{display:none!important}
@media(min-width:1024px){.desk{display:flex!important}}
.mob{display:flex!important}
@media(min-width:1024px){.mob{display:none!important}}
@media(max-width:1023px){.main-area{padding-bottom:80px}}

.stagger>*{animation:cardIn .35s both}
.stagger>*:nth-child(1){animation-delay:.02s}
.stagger>*:nth-child(2){animation-delay:.04s}
.stagger>*:nth-child(3){animation-delay:.06s}
.stagger>*:nth-child(4){animation-delay:.08s}
.stagger>*:nth-child(5){animation-delay:.1s}
.stagger>*:nth-child(6){animation-delay:.12s}
.stagger>*:nth-child(n+7){animation-delay:.14s}

.noise{position:fixed;inset:0;z-index:9998;pointer-events:none;opacity:.018;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.film-grain{position:fixed;inset:0;z-index:9997;pointer-events:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");opacity:.4}

.syne{font-family:'Syne',system-ui,sans-serif}
.icon-3d{filter:drop-shadow(0 4px 8px rgba(0,0,0,.6)) drop-shadow(0 1px 2px rgba(255,255,255,.1));transition:transform .2s,filter .2s}
.icon-3d:hover{transform:translateY(-2px) scale(1.1);filter:drop-shadow(0 8px 16px rgba(0,0,0,.8)) drop-shadow(0 2px 4px ${p}66)}
.page-sheet{max-width:480px;border-radius:26px 26px 0 0!important}
@media(min-width:640px){.page-sheet{border-radius:26px!important;margin-bottom:16px}}

/* Pagination */
.pgn-btn{min-width:38px;height:38px;border-radius:11px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.06);color:rgba(255,255,255,.55);cursor:pointer;font-size:13px;font-weight:800;font-family:inherit;transition:all .18s;display:flex;align-items:center;justify-content:center;padding:0 10px;gap:6px}
.pgn-btn:hover:not(:disabled){background:rgba(255,255,255,.13);transform:translateY(-1px)}
.pgn-btn:disabled{opacity:.3;cursor:not-allowed}
.pgn-btn.active{background:linear-gradient(135deg,${p},${s});color:#000;border-color:transparent;box-shadow:0 4px 14px ${p}44;transform:scale(1.08)}
.pgn-btn.nav{padding:0 16px;gap:8px}

/* Player */
.player-modal{position:fixed;inset:0;z-index:9800;background:#000;display:flex;flex-direction:column}
.player-header{display:flex;align-items:center;gap:10;padding:0 13px;height:50px;flex-shrink:0;background:rgba(0,0,0,.9);border-bottom:1px solid rgba(255,255,255,.08);z-index:10}
.player-body{flex:1;display:flex;overflow:hidden;min-height:0}
.player-video{background:#000;position:relative;overflow:hidden}
.player-info{overflow:hidden;border-top:1px solid rgba(255,255,255,.07)}

/* Mobile: video top, info bottom scrollable */
@media(max-width:1023px){
  .player-body{flex-direction:column}
  .player-video{flex-shrink:0;height:240px;width:100%}
  .player-info{flex:1;overflow-y:auto}
}
/* Desktop: video left, info right */
@media(min-width:1024px){
  .player-body{flex-direction:row}
  .player-video{flex:1;height:100%}
  .player-info{width:340px;flex-shrink:0;overflow-y:auto;border-top:none;border-left:1px solid rgba(255,255,255,.07)}
}

/* Kodik translation picker */
.trans-pill{padding:5px 12px;border-radius:99px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .18s;border:1.5px solid;white-space:nowrap;flex-shrink:0}
.trans-pill:hover{transform:translateY(-1px)}
`;

/* ═══════════════════════════════════════════════
   MICRO UI
═══════════════════════════════════════════════ */
const Spinner = memo(({ size = 22, color = 'rgba(255,255,255,.5)' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation:'spin .7s linear infinite', flexShrink:0 }}>
    <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2.5" stroke="rgba(255,255,255,.1)"/>
    <path d="M12 3a9 9 0 0 1 9 9" fill="none" strokeWidth="2.5" stroke={color} strokeLinecap="round"/>
  </svg>
));

const Bar = memo(({ value, max, grad, h = 5, style = {} }) => {
  const pct = Math.min(Math.max((value / Math.max(max, 1)) * 100, 0), 100);
  return (
    <div style={{ height:h, borderRadius:99, overflow:'hidden', background:'rgba(255,255,255,.1)', ...style }}>
      <div style={{ width:`${pct}%`, height:'100%', borderRadius:99, background:grad, transition:'width .7s cubic-bezier(.4,0,.2,1)' }}/>
    </div>
  );
});

const Toggle = memo(({ v, onChange, color }) => (
  <div onClick={() => onChange(!v)} style={{ width:46, height:26, borderRadius:99, position:'relative', cursor:'pointer', flexShrink:0, transition:'all .3s', background:v ? `linear-gradient(90deg,${color},${color}aa)` : 'rgba(255,255,255,.15)' }}>
    <div style={{ position:'absolute', top:3, left:4, width:20, height:20, borderRadius:'50%', background:'white', boxShadow:'0 2px 8px rgba(0,0,0,.4)', transition:'transform .3s cubic-bezier(.34,1.56,.64,1)', transform:`translateX(${v ? 19 : 0}px)` }}/>
  </div>
));

const IMDbScore = memo(({ n }) => {
  const x = parseFloat(n);
  const c = x >= 7.5 ? '#22c55e' : x >= 6 ? '#eab308' : x >= 5 ? '#f97316' : '#ef4444';
  return <span style={{ display:'inline-flex', alignItems:'center', gap:2, borderRadius:8, padding:'1px 8px', fontSize:11, fontWeight:700, background:`${c}22`, color:c, border:`1px solid ${c}44`, flexShrink:0 }}>★ {n}</span>;
});

const StatusBadge = memo(({ status, lang }) => {
  const m = { watching:{ c:'#60a5fa' }, planned:{ c:'#f59e0b' }, completed:{ c:'#22c55e' } };
  const x = m[status]; if (!x) return null;
  const lb = { watching: t('watching', lang), planned: t('planned', lang), completed: t('watched', lang) };
  return <span style={{ display:'inline-block', borderRadius:7, padding:'2px 8px', fontSize:10, fontWeight:700, background:`${x.c}dd`, color:'#000' }}>{lb[status]}</span>;
});

const SkeletonCard = memo(() => (
  <div style={{ borderRadius:16, overflow:'hidden', aspectRatio:'2/3', background:'#0a0a14', position:'relative' }}>
    <div className="shimmer" style={{ position:'absolute', inset:0 }}/>
    <div style={{ position:'absolute', bottom:0, left:0, right:0, padding:10 }}>
      <div style={{ height:8, width:'60%', borderRadius:6, background:'rgba(255,255,255,.07)', marginBottom:6 }}/>
      <div style={{ height:6, width:'40%', borderRadius:6, background:'rgba(255,255,255,.05)' }}/>
    </div>
  </div>
));

const Toasts = memo(({ items }) => {
  const cfg = { success:{ i:'✓', c:'#22c55e' }, error:{ i:'✕', c:'#ef4444' }, info:{ i:'ℹ', c:'#60a5fa' }, warning:{ i:'!', c:'#f59e0b' } };
  return (
    <div style={{ position:'fixed', top:68, right:14, zIndex:12000, display:'flex', flexDirection:'column', gap:8, width:'min(300px,calc(100vw - 28px))', pointerEvents:'none' }}>
      {items.map(({ id, msg, type }) => {
        const { i, c } = cfg[type] ?? cfg.info;
        return (
          <div key={id} className="glass-dark" style={{ borderRadius:14, overflow:'hidden', animation:'toastIn .3s both', pointerEvents:'auto', borderLeft:`3px solid ${c}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px' }}>
              <div style={{ width:24, height:24, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', background:`${c}22`, color:c, fontSize:11, fontWeight:900, flexShrink:0 }}>{i}</div>
              <p style={{ fontSize:13, fontWeight:600, color:'rgba(255,255,255,.9)', lineHeight:1.35 }}>{msg}</p>
            </div>
            <div style={{ height:2, background:c, animation:'barFill 3.8s linear forwards', animationDirection:'reverse' }}/>
          </div>
        );
      })}
    </div>
  );
});

const Pagination = memo(({ page, setPage, hasMore, loading, themeP, themeS, lang, total }) => {
  const goTo = useCallback((pg) => {
    if (pg < 1) return;
    setPage(pg);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [setPage]);

  const pages = useMemo(() => {
    const start = Math.max(1, page - 2);
    return Array.from({ length: 5 }, (_, i) => start + i);
  }, [page]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16, alignItems:'center', margin:'28px 0 8px' }}>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', justifyContent:'center' }}>
        {page > 3 && (
          <>
            <button className="pgn-btn" onClick={() => goTo(1)} disabled={loading}>1</button>
            {page > 4 && <span style={{ color:'rgba(255,255,255,.2)', fontSize:13 }}>…</span>}
          </>
        )}
        {pages.map(pg => (
          <button key={pg} className={`pgn-btn${pg === page ? ' active' : ''}`} onClick={() => goTo(pg)} disabled={loading}>{pg}</button>
        ))}
        {hasMore && <span style={{ color:'rgba(255,255,255,.2)', fontSize:13 }}>…</span>}
      </div>
      <div style={{ display:'flex', gap:10, alignItems:'center' }}>
        <button className="pgn-btn nav" onClick={() => goTo(page - 1)} disabled={page <= 1 || loading}>
          ← {t('prevPage', lang)}
        </button>
        <div style={{ padding:'8px 18px', borderRadius:11, background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.1)', fontSize:12, fontWeight:700, color:'rgba(255,255,255,.4)', minWidth:80, textAlign:'center' }}>
          {loading ? <Spinner size={14}/> : <>{t('page', lang)} <span style={{ color:'white', fontWeight:800 }}>{page}</span></>}
        </div>
        <button className="pgn-btn nav" onClick={() => goTo(page + 1)} disabled={!hasMore || loading}
          style={{ background: hasMore ? `linear-gradient(135deg,${themeP}22,${themeS}11)` : undefined, borderColor: hasMore ? `${themeP}44` : undefined, color: hasMore ? themeP : undefined }}>
          {t('nextPage', lang)} →
        </button>
      </div>
      {total > 0 && <p style={{ fontSize:11, color:'rgba(255,255,255,.25)', fontWeight:600 }}>{t('page', lang)} {page} · {total.toLocaleString()} {t('films', lang)}</p>}
    </div>
  );
});

/* ═══════════════════════════════════════════════
   LAZY IMAGE
═══════════════════════════════════════════════ */
const LazyImg = memo(({ src, alt, style, onLoad }) => {
  const ref = useRef(null);
  const [loaded, setLoaded] = useState(() => imgCache.has(src));
  const [visible, setVisible] = useState(() => imgCache.has(src));

  useEffect(() => {
    if (!src || visible) return;
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: '400px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [src, visible]);

  const handleLoad = useCallback(() => {
    imgCache.add(src);
    setLoaded(true);
    onLoad?.();
  }, [src, onLoad]);

  return (
    <div ref={ref} style={{ position:'absolute', inset:0 }}>
      {visible && (
        <img src={src} alt={alt || ''} onLoad={handleLoad} loading="lazy" decoding="async"
          style={{ ...style, opacity: loaded ? 1 : 0, transition: 'opacity .4s ease' }}/>
      )}
      {!loaded && <div className="shimmer" style={{ position:'absolute', inset:0 }}/>}
    </div>
  );
});

/* ═══════════════════════════════════════════════
   EMBED PLAYER — FIXED + Language Selector
═══════════════════════════════════════════════ */
const EmbedPlayer = memo(({ movie, themeP, lang, playerSrc, onPlayerChange }) => {
  const [started,       setStarted]       = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [embedUrl,      setEmbedUrl]      = useState(null);
  const [err,           setErr]           = useState(null);
  const [iframeKey,     setIframeKey]     = useState(0);
  // Kodik translations
  const [translations,  setTranslations]  = useState([]);
  const [selTransIdx,   setSelTransIdx]   = useState(0);
  const [transLoading,  setTransLoading]  = useState(false);
  const iframeRef = useRef(null);

  const tmdbId = movie?.tmdb_id;
  const imdbId = movie?.imdb_code;
  const currentPlayer = PLAYERS.find(p => p.id === playerSrc) ?? PLAYERS[0];

  /* ── Resolve translations list (Kodik only) ── */
  const loadKodikTranslations = useCallback(async () => {
    setTransLoading(true);
    setErr(null);
    setTranslations([]);
    try {
      let iid = imdbId;
      if (!iid && tmdbId) iid = await getImdbId(tmdbId);
      const results = await kodikSearchAll(iid, tmdbId);
      if (results.length === 0) {
        setErr(t('notAvail', lang));
        setTransLoading(false);
        return;
      }
      // Sort: RU dub first
      const sorted = [...results].sort((a, b) => {
        const aRu = a.translation?.title?.toLowerCase().includes('дубл') ? 0 : 1;
        const bRu = b.translation?.title?.toLowerCase().includes('дубл') ? 0 : 1;
        return aRu - bRu;
      });
      setTranslations(sorted);
      setSelTransIdx(0);
      const link = sorted[0]?.link;
      if (link) setEmbedUrl(link.startsWith('//') ? `https:${link}` : link);
      else setErr(t('notAvail', lang));
    } catch {
      setErr(t('notAvail', lang));
    }
    setTransLoading(false);
  }, [imdbId, tmdbId, lang]);

  /* ── Resolve non-kodik URL ── */
  const resolveOtherUrl = useCallback((pl) => {
    const url = pl.url(imdbId, tmdbId);
    if (url) { setEmbedUrl(url); setErr(null); }
    else setErr(t('notAvail', lang));
  }, [imdbId, tmdbId, lang]);

  /* ── Start playing ── */
  const handleStart = useCallback(() => {
    setStarted(true);
    setLoading(true);
    setEmbedUrl(null);
    setErr(null);
    if (currentPlayer.kodik) {
      loadKodikTranslations().finally(() => setLoading(false));
    } else {
      resolveOtherUrl(currentPlayer);
      setLoading(false);
    }
  }, [currentPlayer, loadKodikTranslations, resolveOtherUrl]);

  /* ── Switch player source ── */
  const switchPlayer = useCallback((id) => {
    onPlayerChange(id);
    setEmbedUrl(null);
    setErr(null);
    setTranslations([]);
    setSelTransIdx(0);
    setIframeKey(k => k + 1);
    const pl = PLAYERS.find(p => p.id === id) ?? PLAYERS[0];
    if (pl.kodik) {
      setTransLoading(true);
      loadKodikTranslations().finally(() => setTransLoading(false));
    } else {
      resolveOtherUrl(pl);
    }
  }, [onPlayerChange, loadKodikTranslations, resolveOtherUrl]);

  /* ── Switch translation (Kodik) ── */
  const switchTranslation = useCallback((idx) => {
    setSelTransIdx(idx);
    const item = translations[idx];
    if (!item?.link) return;
    const link = item.link.startsWith('//') ? `https:${item.link}` : item.link;
    setEmbedUrl(link);
    setIframeKey(k => k + 1);
    setErr(null);
  }, [translations]);

  /* ── Helper: translation display name ── */
  const getTransLabel = (item) => {
    const title = item?.translation?.title ?? item?.translation?.type ?? 'Unknown';
    const meta = LANG_META[title];
    if (meta) return `${meta.flag} ${title}`;
    // Try to detect from title
    if (title.toLowerCase().includes('дубл')) return `🎙 ${title}`;
    if (title.toLowerCase().includes('суб') || title.toLowerCase().includes('sub')) return `📝 ${title}`;
    if (title.toLowerCase().includes('укр')) return `🇺🇦 ${title}`;
    if (title.toLowerCase().includes('каз')) return `🇰🇿 ${title}`;
    if (title.toLowerCase().includes('узб')) return `🇺🇿 ${title}`;
    if (title.toLowerCase().includes('тадж')) return `🇹🇯 ${title}`;
    if (title.toLowerCase().includes('eng') || title.toLowerCase().includes('english')) return `🇬🇧 ${title}`;
    return `🎬 ${title}`;
  };

  const isKodik = currentPlayer.kodik;

  if (!tmdbId && !imdbId) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:12, padding:24, textAlign:'center', background:'#000' }}>
      <span style={{ fontSize:44, animation:'float 3s ease infinite' }}>🎬</span>
      <p style={{ fontSize:14, color:'rgba(255,255,255,.4)', fontWeight:600 }}>{t('notAvail', lang)}</p>
    </div>
  );

  return (
    <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', background:'#000', minHeight:0 }}>

      {/* ── Top bar: Source selector ── */}
      <div style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 10px', background:'rgba(0,0,0,.9)', flexShrink:0, borderBottom:'1px solid rgba(255,255,255,.08)', flexWrap:'wrap' }}>
        <span style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,.3)', textTransform:'uppercase', letterSpacing:'.06em', marginRight:4, flexShrink:0 }}>
          {t('source', lang)}:
        </span>
        {PLAYERS.map(pl => {
          const active = pl.id === playerSrc;
          return (
            <button key={pl.id}
              onClick={() => started ? switchPlayer(pl.id) : null}
              style={{ padding:'4px 12px', borderRadius:99, fontFamily:'inherit', border:`1px solid ${active?themeP+'77':'rgba(255,255,255,.14)'}`, background:active?`linear-gradient(135deg,${themeP},${themeP}88)`:'rgba(255,255,255,.07)', color:active?'#000':'rgba(255,255,255,.55)', cursor:started?'pointer':'default', fontSize:11, fontWeight:800, transition:'all .18s', boxShadow:active?`0 3px 12px ${themeP}55`:'none', opacity:started?1:.6 }}>
              {pl.n}
            </button>
          );
        })}
      </div>

      {/* ── Kodik translation bar (shown after loading) ── */}
      {started && isKodik && (transLoading || translations.length > 0) && (
        <div style={{ flexShrink:0, background:'rgba(0,0,0,.85)', borderBottom:'1px solid rgba(255,255,255,.07)', padding:'6px 10px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,.3)', textTransform:'uppercase', letterSpacing:'.05em', flexShrink:0 }}>
              🎙 {t('dubbing', lang)}:
            </span>
            {transLoading ? (
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <Spinner size={14} color={themeP}/>
                <span style={{ fontSize:11, color:'rgba(255,255,255,.3)' }}>{t('loading', lang)}</span>
              </div>
            ) : (
              <div className="ns" style={{ display:'flex', gap:5, overflowX:'auto', flex:1 }}>
                {translations.map((item, idx) => {
                  const active = idx === selTransIdx;
                  return (
                    <button key={idx} className="trans-pill"
                      onClick={() => switchTranslation(idx)}
                      style={{ borderColor: active ? themeP : 'rgba(255,255,255,.15)', background: active ? `linear-gradient(135deg,${themeP}33,${themeP}22)` : 'rgba(255,255,255,.05)', color: active ? themeP : 'rgba(255,255,255,.55)', boxShadow: active ? `0 2px 10px ${themeP}44` : 'none' }}>
                      {getTransLabel(item)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Video area ── */}
      <div style={{ flex:1, position:'relative', minHeight:0, background:'#000' }}>

        {/* POSTER / PLAY BUTTON */}
        {!started && (
          <div style={{ position:'absolute', inset:0, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:20, zIndex:2 }}
            onClick={handleStart}>
            {/* Blurred backdrop */}
            {movie.background_image && (
              <img src={movie.background_image || movie.medium_cover_image} alt=""
                style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', filter:'blur(22px) brightness(.3) saturate(1.5)', transform:'scale(1.1)', display:'block' }}/>
            )}
            <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top, rgba(0,0,0,.85) 0%, rgba(0,0,0,.2) 100%)' }}/>

            {/* Poster card */}
            <div style={{ position:'relative', zIndex:3, display:'flex', flexDirection:'column', alignItems:'center', gap:16, padding:'0 24px', maxWidth:340, width:'100%' }}>
              {movie.medium_cover_image && (
                <div style={{ width:100, borderRadius:16, overflow:'hidden', aspectRatio:'2/3', boxShadow:`0 16px 48px rgba(0,0,0,.8), 0 0 0 2px ${themeP}44`, flexShrink:0 }}>
                  <img src={movie.medium_cover_image} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
                </div>
              )}
              <div style={{ textAlign:'center' }}>
                <p className="syne lc2" style={{ fontSize:18, fontWeight:800, color:'white', marginBottom:4, lineHeight:1.3, textShadow:'0 2px 12px rgba(0,0,0,.8)' }}>{movie.title}</p>
                <div style={{ display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap' }}>
                  {movie.year && <span style={{ fontSize:12, color:'rgba(255,255,255,.5)', fontWeight:600 }}>{movie.year}</span>}
                  {movie.rating > 0 && <IMDbScore n={movie.rating}/>}
                </div>
              </div>
              <button
                style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 28px', borderRadius:16, background:`linear-gradient(135deg,${themeP},${themeP}bb)`, border:'none', cursor:'pointer', fontFamily:'inherit', fontWeight:800, fontSize:15, color:'#000', boxShadow:`0 8px 32px ${themeP}66, 0 0 0 0 ${themeP}44`, transition:'all .2s', animation:'glow 2.5s ease infinite' }}
                onMouseEnter={e => e.currentTarget.style.transform='scale(1.06)'}
                onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}>
                <svg width="22" height="22" viewBox="0 0 32 32" fill="none"><polygon points="10,8 10,24 26,16" fill="rgba(0,0,0,.8)"/></svg>
                {t('watch', lang)}
              </button>
              <p style={{ fontSize:11, color:'rgba(255,255,255,.35)', fontWeight:600 }}>Kodik · VidSrc · Videasy +</p>
            </div>
          </div>
        )}

        {/* LOADING OVERLAY */}
        {started && loading && (
          <div style={{ position:'absolute', inset:0, zIndex:4, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, background:'rgba(0,0,0,.95)' }}>
            <div style={{ position:'relative' }}>
              <Spinner size={52} color={themeP}/>
              <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                <span style={{ fontSize:18 }}>🎬</span>
              </div>
            </div>
            <p style={{ fontSize:14, fontWeight:700, color:'rgba(255,255,255,.6)' }}>{t('loading', lang)}</p>
            <p style={{ fontSize:12, color:`${themeP}99` }}>{currentPlayer.n}</p>
          </div>
        )}

        {/* ERROR OVERLAY */}
        {started && err && !loading && (
          <div style={{ position:'absolute', inset:0, zIndex:4, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, background:'rgba(0,0,0,.95)', padding:24, textAlign:'center' }}>
            <span style={{ fontSize:48 }}>⚠️</span>
            <div>
              <p style={{ fontSize:15, fontWeight:700, color:'#ef4444', marginBottom:8 }}>{err}</p>
              <p style={{ fontSize:12, color:'rgba(255,255,255,.35)' }}>{t('tryOther', lang)}</p>
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'center' }}>
              {PLAYERS.filter(p => p.id !== playerSrc).slice(0, 3).map(pl => (
                <button key={pl.id} onClick={() => switchPlayer(pl.id)}
                  style={{ padding:'8px 16px', borderRadius:10, border:`1px solid ${themeP}44`, background:`${themeP}18`, color:themeP, cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:'inherit' }}>
                  {pl.n}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* IFRAME */}
        {started && embedUrl && !loading && !err && (
          <iframe
            ref={iframeRef}
            key={`${iframeKey}-${playerSrc}-${selTransIdx}`}
            src={embedUrl}
            allowFullScreen
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media; gyroscope; accelerometer"
            referrerPolicy="no-referrer-when-downgrade"
            style={{ width:'100%', height:'100%', border:'none', display:'block', position:'absolute', inset:0 }}
            onError={() => setErr(t('notAvail', lang))}
          />
        )}
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════
   DETAIL PANEL
═══════════════════════════════════════════════ */
const DetailPanel = memo(({ movie, lib, ratings, notes, favs, wl, themeP, isAuth, onStatus, onRate, onNote, onFav, onWL, onShare, lang }) => {
  const status   = lib[movie?.id]?.status;
  const rating   = ratings[movie?.id];
  const note     = notes[movie?.id] ?? '';
  const isFav    = favs.has(movie?.id);
  const inWL     = wl.has(movie?.id);
  const grad     = `linear-gradient(135deg,${themeP},${themeP}88)`;

  const btn = (active, c) => ({ padding:'10px 12px', borderRadius:11, border:`1.5px solid ${active?c+'55':'transparent'}`, cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', transition:'all .2s', background:active?`${c}18`:'rgba(255,255,255,.04)', color:active?c:'rgba(255,255,255,.4)', width:'100%', textAlign:'left' });

  if (!movie) return null;
  return (
    <div className="ns" style={{ overflowY:'auto', padding:14, display:'flex', flexDirection:'column', gap:11, height:'100%' }}>
      <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
        {movie.medium_cover_image && (
          <div style={{ width:76, flexShrink:0, borderRadius:12, overflow:'hidden', aspectRatio:'2/3', boxShadow:`0 8px 28px rgba(0,0,0,.6),0 0 0 2px ${themeP}44` }}>
            <img src={movie.medium_cover_image} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
          </div>
        )}
        <div style={{ flex:1, minWidth:0 }}>
          <p className="syne lc2" style={{ fontSize:16, fontWeight:800, color:'white', lineHeight:1.3, marginBottom:5 }}>{movie.title}</p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:8 }}>
            {movie.rating > 0 && <IMDbScore n={movie.rating}/>}
            {movie.year && <span style={{ fontSize:11, padding:'2px 8px', borderRadius:7, background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.45)', fontWeight:600 }}>{movie.year}</span>}
            {movie.runtime > 0 && <span style={{ fontSize:11, padding:'2px 8px', borderRadius:7, background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.45)', fontWeight:600 }}>{movie.runtime}m</span>}
            {movie.language && <span style={{ fontSize:11, padding:'2px 8px', borderRadius:7, background:`${themeP}22`, color:themeP, fontWeight:700 }}>{movie.language.toUpperCase()}</span>}
          </div>
          {movie.genres?.length > 0 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
              {movie.genres.map(g => <span key={g} style={{ fontSize:10, padding:'2px 8px', borderRadius:20, background:`${themeP}18`, color:`${themeP}cc`, border:`1px solid ${themeP}30`, fontWeight:600 }}>{g}</span>)}
            </div>
          )}
        </div>
      </div>

      {movie.description_full && (
        <div style={{ padding:12, borderRadius:12, background:'rgba(255,255,255,.04)', border:`1px solid ${themeP}22` }}>
          <p style={{ fontSize:11, fontWeight:700, color:themeP, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>{t('synopsis', lang)}</p>
          <p className="lc3" style={{ fontSize:12, lineHeight:1.68, color:'rgba(255,255,255,.6)' }}>{movie.description_full}</p>
        </div>
      )}

      <div>
        <p style={{ fontSize:10, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>Status</p>
        <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
          {[['watching','👁 ' + t('watching', lang),'#60a5fa'],['planned','⏳ ' + t('planned', lang),'#f59e0b'],['completed','✅ ' + t('watched', lang),'#22c55e']].map(([k, l, c]) => (
            <button key={k} onClick={() => onStatus(movie, k)} style={btn(status===k, c)}>{l}</button>
          ))}
        </div>
      </div>

      <div>
        <p style={{ fontSize:10, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>{t('yourRating', lang)}</p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:5 }}>
          {[1,2,3,4,5,6,7,8,9,10].map(sc => (
            <button key={sc} onClick={() => onRate(movie, sc)} style={{ aspectRatio:'1/1', borderRadius:10, border:'none', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', transition:'all .2s', background:rating===sc?grad:'rgba(255,255,255,.07)', color:rating===sc?'#000':'rgba(255,255,255,.35)', transform:rating===sc?'scale(1.12)':'scale(1)', animation:rating===sc?'pop .3s ease both':'' }}>{sc}</button>
          ))}
        </div>
      </div>

      {isAuth && (
        <div>
          <p style={{ fontSize:10, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>{t('note', lang)}</p>
          <textarea value={note} onChange={e => onNote(movie.id, e.target.value)} placeholder="Your thoughts…" rows={3}
            style={{ width:'100%', padding:'10px 12px', borderRadius:11, border:`1.5px solid ${note?themeP+'66':'rgba(255,255,255,.1)'}`, background:'rgba(255,255,255,.04)', color:'rgba(255,255,255,.8)', fontSize:12, fontWeight:500, resize:'vertical', outline:'none', fontFamily:'inherit', transition:'border-color .2s', minHeight:70 }}/>
        </div>
      )}

      <div style={{ display:'flex', gap:7 }}>
        <button onClick={() => onWL(movie)} style={{ ...btn(inWL, themeP), flex:1 }}>{inWL ? '✓ ' + t('watchlist', lang) : '+ ' + t('watchlist', lang)}</button>
        <button onClick={() => onFav(movie)} style={{ ...btn(isFav, '#f43f5e'), flex:1 }}>{isFav ? '♥ ' + t('favs', lang) : '♡ ' + t('favs', lang)}</button>
      </div>
      <button onClick={() => onShare(movie)} className="btn-g" style={{ padding:'9px', borderRadius:11, fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
        <span>📤</span><span>{t('share', lang)}</span>
      </button>
      {movie.imdb_code && (
        <a href={`https://www.imdb.com/title/${movie.imdb_code}`} target="_blank" rel="noreferrer"
          style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'9px', borderRadius:11, border:'1px solid rgba(234,179,8,.3)', background:'rgba(234,179,8,.08)', color:'#fbbf24', fontSize:12, fontWeight:700 }}>
          🎬 IMDb
        </a>
      )}
    </div>
  );
});

/* ═══════════════════════════════════════════════
   ITEM MODAL — FIXED LAYOUT
═══════════════════════════════════════════════ */
const ItemModal = memo(({ movie, ...rest }) => {
  if (!movie) return null;
  const { themeP, onClose, lang, playerSrc, onPlayerChange } = rest;
  return (
    <div className="fi player-modal">
      {/* Header */}
      <div className="player-header" style={{ display:'flex', alignItems:'center', gap:10, padding:'0 13px', height:50, flexShrink:0, background:'rgba(0,0,0,.92)', borderBottom:'1px solid rgba(255,255,255,.08)' }}>
        <button onClick={onClose} style={{ width:34, height:34, borderRadius:10, border:'none', background:'rgba(255,255,255,.08)', cursor:'pointer', color:'white', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontFamily:'inherit' }}>←</button>
        <p className="lc1 syne" style={{ fontSize:14, fontWeight:700, color:'white', flex:1 }}>{movie.title}</p>
        {movie.year && <span style={{ fontSize:12, color:'rgba(255,255,255,.3)', fontWeight:600, flexShrink:0 }}>{movie.year}</span>}
        {movie.rating > 0 && <IMDbScore n={movie.rating}/>}
        <button onClick={onClose} style={{ width:32, height:32, borderRadius:10, border:'1px solid rgba(239,68,68,.35)', background:'rgba(239,68,68,.1)', cursor:'pointer', color:'#f87171', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontFamily:'inherit' }}>✕</button>
      </div>

      {/* Body */}
      <div className="player-body">
        <div className="player-video">
          <EmbedPlayer
            movie={movie}
            themeP={themeP}
            lang={lang}
            playerSrc={playerSrc}
            onPlayerChange={onPlayerChange}
          />
        </div>
        <div className="player-info">
          <DetailPanel movie={movie} {...rest}/>
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════
   MOVIE CARD
═══════════════════════════════════════════════ */
const MovieCard = memo(({ movie, onClick, onFav, faved, status, userRating, themeP, lang = 'en' }) => {
  const [hover, setHover] = useState(false);
  const minLbl = { uz:'daq', ru:'мин', en:'min' }[lang] ?? 'min';
  const genreLabels = useMemo(() =>
    (movie.genres ?? []).slice(0, 2).map(g => {
      const found = GENRES.find(x => x.id === g.toLowerCase());
      return found ? (found[lang] ?? found.en) : g;
    }),
  [movie.genres, lang]);

  return (
    <article onClick={() => onClick(movie)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ cursor:'pointer', position:'relative', borderRadius:16, zIndex:hover?10:1 }}>
      <div className="movie-card" style={{ boxShadow:hover?`0 24px 48px rgba(0,0,0,.7),0 0 0 1px ${themeP}44`:'' }}>
        <LazyImg src={movie.medium_cover_image} alt={movie.title} style={{ width:'100%', height:'100%', objectFit:'cover', position:'absolute', inset:0 }}/>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top,rgba(0,0,0,.95) 0%,rgba(0,0,0,.15) 45%,transparent 70%)' }}/>
        {hover && <div style={{ position:'absolute', inset:0, background:`linear-gradient(to top,${themeP}44,transparent)` }}/>}
        <div style={{ position:'absolute', top:8, left:8, right:8, display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          {status && <StatusBadge status={status} lang={lang}/>}
          {userRating && <span style={{ marginLeft:'auto', background:'rgba(234,179,8,.95)', color:'#000', borderRadius:7, padding:'2px 7px', fontSize:10, fontWeight:800 }}>★{userRating}</span>}
        </div>
        <div style={{ position:'absolute', bottom:0, left:0, right:0, padding:'8px 10px 10px' }}>
          {movie.rating > 0 && <IMDbScore n={movie.rating}/>}
          <p className="lc2 syne" style={{ marginTop:4, fontSize:12, fontWeight:700, color:'white', lineHeight:1.3 }}>{movie.title}</p>
          <div style={{ display:'flex', gap:5, marginTop:3 }}>
            {movie.year && <span style={{ fontSize:10, fontWeight:600, color:'rgba(255,255,255,.4)' }}>{movie.year}</span>}
            {movie.runtime > 0 && <span style={{ fontSize:10, fontWeight:600, color:'rgba(255,255,255,.3)' }}>{movie.runtime} {minLbl}</span>}
          </div>
          {genreLabels.length > 0 && (
            <div style={{ display:'flex', gap:4, marginTop:4, flexWrap:'wrap' }}>
              {genreLabels.map(g => <span key={g} style={{ fontSize:9, padding:'1px 6px', borderRadius:20, background:`${themeP}22`, color:`${themeP}cc`, border:`1px solid ${themeP}25`, fontWeight:700 }}>{g}</span>)}
            </div>
          )}
        </div>
        <button onClick={e => { e.stopPropagation(); onFav(movie); }} style={{ position:'absolute', bottom:9, right:9, width:30, height:30, borderRadius:9, border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, background:faved?'#f43f5e99':'rgba(0,0,0,.55)', backdropFilter:'blur(8px)', transition:'all .2s', color:'white', zIndex:2, animation:faved?'heartPop .3s ease':'' }}>
          {faved ? '♥' : '♡'}
        </button>
        {faved && <div style={{ position:'absolute', inset:0, borderRadius:16, boxShadow:'inset 0 0 0 2px #f43f5e66', pointerEvents:'none' }}/>}
      </div>
    </article>
  );
});

/* ═══════════════════════════════════════════════
   CATEGORY ROW
═══════════════════════════════════════════════ */
const CategoryRow = memo(({ title, movies, onOpen, onFav, favIds, lib, ratings, themeP, icon, lang = 'en' }) => {
  const rowRef = useRef(null);
  const scroll = d => rowRef.current?.scrollBy({ left: d * 210, behavior:'smooth' });
  if (!movies.length) return null;
  return (
    <section style={{ marginBottom:28 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, paddingRight:4 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {icon && <span style={{ fontSize:20 }}>{icon}</span>}
          <h2 className="syne" style={{ fontSize:18, fontWeight:700, margin:0 }}>{title}</h2>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={() => scroll(-1)} style={{ width:30, height:30, borderRadius:9, border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.06)', color:'rgba(255,255,255,.5)', cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit' }}>‹</button>
          <button onClick={() => scroll(1)} style={{ width:30, height:30, borderRadius:9, border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.06)', color:'rgba(255,255,255,.5)', cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit' }}>›</button>
        </div>
      </div>
      <div ref={rowRef} className="ns" style={{ display:'flex', gap:10, overflowX:'auto', paddingBottom:4 }}>
        {movies.map((m, i) => (
          <div key={`${m.id}-${i}`} style={{ flexShrink:0, width:148, animation:`cardIn .35s ${Math.min(i * .03, .4)}s both` }}>
            <MovieCard movie={m} onClick={onOpen} onFav={onFav} faved={favIds.has(m.id)} status={lib[m.id]?.status} userRating={ratings[m.id]} themeP={themeP} lang={lang}/>
          </div>
        ))}
      </div>
    </section>
  );
});

/* ═══════════════════════════════════════════════
   SEARCH OVERLAY
═══════════════════════════════════════════════ */
const SearchOverlay = memo(({ onClose, themeP, onOpen, lang }) => {
  const [q, setQ]     = useState('');
  const [res, setRes] = useState([]);
  const [ld, setLd]   = useState(false);
  const inputRef = useRef(null);
  const debRef   = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!q.trim()) { setRes([]); return; }
    setLd(true); clearTimeout(debRef.current);
    debRef.current = setTimeout(async () => {
      try {
        const d = await tmdbFetch(`/search/movie?query=${encodeURIComponent(q)}&page=1`, lang);
        setRes((d?.results ?? []).slice(0, 12).map(normalizeTMDB));
      } catch {}
      setLd(false);
    }, 350);
  }, [q, lang]);

  return (
    <div className="fi" style={{ position:'fixed', inset:0, zIndex:11000, background:'rgba(0,0,0,.9)', backdropFilter:'blur(24px)', display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'80px 16px 16px' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0 }}/>
      <div className="si" style={{ position:'relative', width:'100%', maxWidth:580 }}>
        <div className="glass-dark" style={{ borderRadius:22, overflow:'hidden', boxShadow:`0 32px 80px rgba(0,0,0,.8),0 0 0 1px ${themeP}33` }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px', borderBottom:'1px solid rgba(255,255,255,.08)' }}>
            <span style={{ fontSize:18 }}>🔍</span>
            <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder={t('search', lang) + '…'} style={{ flex:1, background:'transparent', border:'none', outline:'none', fontSize:16, fontWeight:500, color:'white', fontFamily:'inherit' }} onKeyDown={e => e.key==='Escape' && onClose()}/>
            {ld ? <Spinner size={16} color={themeP}/> : q ? <button onClick={() => setQ('')} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,.4)', fontSize:16, padding:0, fontFamily:'inherit' }}>✕</button> : null}
          </div>
          <div className="ns" style={{ maxHeight:420, overflowY:'auto' }}>
            {res.length > 0 ? res.map(m => (
              <div key={m.id} onClick={() => { onOpen(m); onClose(); }} style={{ display:'flex', gap:12, padding:'10px 16px', cursor:'pointer', transition:'background .12s', alignItems:'center' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.07)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <div style={{ width:38, height:56, borderRadius:8, overflow:'hidden', background:'#0a0a14', flexShrink:0 }}>
                  {m.medium_cover_image && <img src={m.medium_cover_image} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <p className="lc1 syne" style={{ fontSize:14, fontWeight:700, color:'white', marginBottom:4 }}>{m.title}</p>
                  <div style={{ display:'flex', gap:5 }}>
                    {m.rating > 0 && <IMDbScore n={m.rating}/>}
                    {m.year && <span style={{ fontSize:11, padding:'1px 7px', borderRadius:6, background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.4)', fontWeight:600 }}>{m.year}</span>}
                  </div>
                </div>
                <span style={{ opacity:.2 }}>→</span>
              </div>
            )) : q && !ld ? (
              <div style={{ padding:'40px', textAlign:'center', color:'rgba(255,255,255,.25)' }}>
                <p style={{ fontSize:14, fontWeight:600 }}>{t('notFound', lang)}</p>
              </div>
            ) : (
              <div style={{ padding:'36px', textAlign:'center' }}>
                <div style={{ fontSize:44, marginBottom:12, animation:'float 3s ease infinite' }}>🎬</div>
                <p style={{ fontSize:13, color:'rgba(255,255,255,.3)', fontWeight:500 }}>Search for movies, titles…</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════
   FILTER PANEL
═══════════════════════════════════════════════ */
const FilterPanel = memo(({ filters, onChange, themeP, onClose, lang }) => {
  const [loc, setLoc] = useState(filters);
  const apply = () => { onChange(loc); onClose(); };
  const reset = () => { const d = { genre:'', year:null, ratingMin:0, quality:'' }; setLoc(d); onChange(d); onClose(); };
  const YEARS = Array.from({ length:40 }, (_, i) => 2025 - i);

  return (
    <div className="fi" style={{ position:'fixed', inset:0, zIndex:11000, display:'flex', alignItems:'flex-end', justifyContent:'center', background:'rgba(0,0,0,.75)', backdropFilter:'blur(16px)' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0 }}/>
      <div className="glass-dark su page-sheet" style={{ position:'relative', width:'100%', padding:'18px 18px 36px', boxShadow:'0 -24px 70px rgba(0,0,0,.7)' }}>
        <div style={{ display:'flex', justifyContent:'center', marginBottom:14 }}><div style={{ width:32, height:4, borderRadius:99, background:'rgba(255,255,255,.2)' }}/></div>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:16, alignItems:'center' }}>
          <h3 className="syne" style={{ fontSize:18, fontWeight:700 }}>{t('filters', lang)}</h3>
          <button onClick={onClose} style={{ width:30, height:30, borderRadius:10, border:'none', background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.5)', cursor:'pointer', fontFamily:'inherit' }}>✕</button>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>Genres</label>
            <div className="ns" style={{ display:'flex', gap:5, overflowX:'auto', paddingBottom:4 }}>
              <button onClick={() => setLoc(p => ({ ...p, genre:'' }))} style={{ flexShrink:0, padding:'6px 12px', borderRadius:99, border:`1px solid ${!loc.genre?themeP+'66':'rgba(255,255,255,.12)'}`, background:!loc.genre?`${themeP}22`:'rgba(255,255,255,.06)', color:!loc.genre?themeP:'rgba(255,255,255,.5)', cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:'inherit' }}>{t('all', lang)}</button>
              {GENRES.map(g => (
                <button key={g.id} onClick={() => setLoc(p => ({ ...p, genre:g.id }))} style={{ flexShrink:0, padding:'6px 12px', borderRadius:99, border:`1px solid ${loc.genre===g.id?themeP+'66':'rgba(255,255,255,.12)'}`, background:loc.genre===g.id?`${themeP}22`:'rgba(255,255,255,.06)', color:loc.genre===g.id?themeP:'rgba(255,255,255,.5)', cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:'inherit' }}>{g.e} {g[lang] || g.en}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>{t('year', lang)}</label>
            <div className="ns" style={{ display:'flex', gap:5, overflowX:'auto', paddingBottom:4 }}>
              <button onClick={() => setLoc(p => ({ ...p, year:null }))} style={{ flexShrink:0, padding:'6px 12px', borderRadius:99, border:`1px solid ${!loc.year?themeP+'66':'rgba(255,255,255,.12)'}`, background:!loc.year?`${themeP}22`:'rgba(255,255,255,.06)', color:!loc.year?themeP:'rgba(255,255,255,.5)', cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:'inherit' }}>{t('all', lang)}</button>
              {YEARS.map(y => (
                <button key={y} onClick={() => setLoc(p => ({ ...p, year:y }))} style={{ flexShrink:0, padding:'6px 12px', borderRadius:99, border:`1px solid ${loc.year===y?themeP+'66':'rgba(255,255,255,.12)'}`, background:loc.year===y?`${themeP}22`:'rgba(255,255,255,.06)', color:loc.year===y?themeP:'rgba(255,255,255,.5)', cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:'inherit' }}>{y}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
              <label style={{ fontSize:11, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.07em' }}>{t('minRating', lang)}</label>
              <span style={{ fontSize:14, fontWeight:800, color:themeP }}>{loc.ratingMin > 0 ? `${loc.ratingMin}+` : t('all', lang)}</span>
            </div>
            <input type="range" min={0} max={9} step={1} value={loc.ratingMin} onChange={e => setLoc(p => ({ ...p, ratingMin:+e.target.value }))} style={{ width:'100%', background:`linear-gradient(90deg,${themeP} ${loc.ratingMin/9*100}%,rgba(255,255,255,.15) ${loc.ratingMin/9*100}%)` }}/>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={reset} className="btn-g" style={{ flex:1, padding:12, borderRadius:13, fontSize:13 }}>↺ {t('reset', lang)}</button>
            <button onClick={apply} className="btn-p" style={{ flex:2, padding:12, borderRadius:13, fontSize:13, boxShadow:`0 8px 24px ${themeP}44` }}>✓ {t('apply', lang)}</button>
          </div>
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════
   STATS PAGE
═══════════════════════════════════════════════ */
const StatsPage = memo(({ stats, user, lib, ratings, favs, achs, themeP, themeS, lang }) => {
  const rank = getRank(user.xp);
  const grad = `linear-gradient(135deg,${themeP},${themeS})`;
  const rvals = Object.values(ratings);
  const dist = Array.from({ length:10 }, (_, i) => ({ s:i+1, c:rvals.filter(r => r===i+1).length }));
  const maxC = Math.max(...dist.map(d => d.c), 1);

  return (
    <div className="fu" style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ borderRadius:20, padding:20, background:`linear-gradient(135deg,${themeP}18,${themeS}0d)`, border:`1px solid ${themeP}33`, position:'relative', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ width:66, height:66, borderRadius:18, background:grad, display:'flex', alignItems:'center', justifyContent:'center', fontSize:30, boxShadow:`0 8px 28px ${themeP}55`, animation:'glow 3s ease infinite', flexShrink:0 }}>{rank.b}</div>
          <div style={{ flex:1, minWidth:0 }}>
            <p className="syne" style={{ fontSize:22, fontWeight:800, color:rank.c, marginBottom:2 }}>{rank.l[lang] || rank.l.en}</p>
            <p style={{ fontSize:12, color:'rgba(255,255,255,.45)', marginBottom:8 }}>{t('level', lang)} {stats.level} · {user.xp} XP</p>
            <Bar value={stats.xpInLvl} max={100} grad={grad}/>
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
        {[[t('watched',lang),stats.watched,'#22c55e','✅'],[t('watching',lang),stats.watching,'#60a5fa','👁'],[t('planned',lang),stats.planned,'#f59e0b','⏳'],['Hours',stats.hours,'#a855f7','⏱'],['Rated',stats.rated,'#eab308','★'],['Avg',stats.avgRating,'#ec4899','♥'],['Favs',favs,'#f43f5e','❤'],['Notes',stats.notes,'#14b8a6','📝']].map(([l,v,c,i]) => (
          <div key={l} style={{ padding:12, borderRadius:13, background:`${c}0e`, border:`1px solid ${c}22` }}>
            <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4 }}>
              <span style={{ fontSize:14 }}>{i}</span>
              <span style={{ fontSize:10, fontWeight:700, color:`${c}88`, textTransform:'uppercase', letterSpacing:'.04em' }}>{l}</span>
            </div>
            <p style={{ fontSize:24, fontWeight:900, color:c, lineHeight:1 }}>{fmt(v)}</p>
          </div>
        ))}
      </div>

      {rvals.length > 0 && (
        <div className="card" style={{ borderRadius:18, padding:18 }}>
          <p style={{ fontSize:11, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>Rating Distribution</p>
          <div style={{ display:'flex', gap:5, alignItems:'flex-end', height:80 }}>
            {dist.map(({ s, c }) => {
              const h = (c / maxC) * 100;
              const col = s >= 8 ? '#22c55e' : s >= 6 ? '#eab308' : s >= 4 ? '#f97316' : '#ef4444';
              return (
                <div key={s} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                  <span style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,.35)' }}>{c||''}</span>
                  <div style={{ width:'100%', borderRadius:'4px 4px 0 0', background:c?col:'rgba(255,255,255,.07)', height:`${Math.max(h,c?8:4)}%`, minHeight:4 }}/>
                  <span style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,.35)' }}>{s}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card" style={{ borderRadius:18, padding:18 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:12 }}>
          <p style={{ fontSize:11, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.08em' }}>{t('achievements', lang)}</p>
          <span style={{ fontSize:12, fontWeight:800, color:themeP }}>{achs.length}/{ACHS.length}</span>
        </div>
        <Bar value={achs.length} max={ACHS.length} grad={grad} style={{ marginBottom:14 }}/>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
          {ACHS.map(a => {
            const done = achs.includes(a.id);
            return (
              <div key={a.id} title={a.n[lang]||a.n.en} style={{ borderRadius:12, padding:'9px 4px', textAlign:'center', background:done?`${themeP}18`:'rgba(255,255,255,.04)', border:`1px solid ${done?themeP+'44':'rgba(255,255,255,.06)'}`, opacity:done?1:.35, transition:'all .3s' }}>
                <span style={{ fontSize:18, display:'block', marginBottom:3 }}>{a.e}</span>
                <p style={{ fontSize:9, fontWeight:700, color:done?'white':'rgba(255,255,255,.5)', lineHeight:1.2 }}>{(a.n[lang]||a.n.en).split(' ')[0]}</p>
                {done && <p style={{ fontSize:9, fontWeight:800, color:themeP, marginTop:2 }}>+{a.xp}XP</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════
   PROFILE SHEET
═══════════════════════════════════════════════ */
const ProfileSheet = memo(({ user, stats, achs, themeP, themeS, syncSt, curTheme, lang, onClose, onSave, onLogout, onExport, onImport, onUser, onTheme, onLang, onResetCfg, fileRef }) => {
  const [tab, setTab] = useState('profile');
  const rank = getRank(user.xp);
  const grad = `linear-gradient(135deg,${themeP},${themeS})`;
  const syncC = { idle:'rgba(255,255,255,.3)', syncing:themeP, synced:'#22c55e', error:'#ef4444' }[syncSt];
  const inp = { width:'100%', padding:'11px 13px', borderRadius:11, border:'1.5px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.06)', color:'white', fontSize:13, fontWeight:500, outline:'none', fontFamily:'inherit', transition:'all .2s' };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9900, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div className="fi" style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.82)', backdropFilter:'blur(18px)' }} onClick={onClose}/>
      <div className="su glass-dark page-sheet" style={{ position:'relative', maxHeight:'92dvh', display:'flex', flexDirection:'column', boxShadow:'0 -28px 70px rgba(0,0,0,.75)' }}>
        <div style={{ display:'flex', justifyContent:'center', padding:'10px 0 4px' }}><div style={{ width:32, height:4, borderRadius:99, background:'rgba(255,255,255,.2)' }}/></div>
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 18px 12px', borderBottom:'1px solid rgba(255,255,255,.07)' }}>
          <div style={{ position:'relative' }}>
            <img src={user.avatar} alt="" onClick={() => fileRef.current?.click()} style={{ width:50, height:50, borderRadius:14, objectFit:'cover', border:`2.5px solid ${themeP}`, boxShadow:`0 0 18px ${themeP}55`, cursor:'pointer', display:'block' }}/>
            <input type="file" ref={fileRef} onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onloadend = () => onUser({ avatar:r.result }); r.readAsDataURL(f); }} accept="image/*" style={{ display:'none' }}/>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <p className="syne lc1" style={{ fontSize:16, fontWeight:700 }}>{user.name}</p>
            <p style={{ fontSize:11, fontWeight:600, color:rank.c }}>{rank.b} {rank.l[lang]||rank.l.en} · Lv.{stats.level}</p>
            {user.email && <p style={{ fontSize:10, color:'rgba(255,255,255,.25)', marginTop:1 }}>{user.email}</p>}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 9px', borderRadius:8, background:'rgba(255,255,255,.06)', color:syncC, fontSize:10, fontWeight:700 }}>
              {syncSt==='syncing' ? <Spinner size={10} color={themeP}/> : <span style={{ width:6, height:6, borderRadius:'50%', background:'currentColor', display:'inline-block' }}/>}
              <span>{syncSt==='synced'?'Saved':syncSt==='syncing'?'Sync...':syncSt==='error'?'Error':'☁'}</span>
            </div>
            <button onClick={onClose} style={{ width:28, height:28, borderRadius:9, border:'none', background:'rgba(255,255,255,.08)', cursor:'pointer', color:'rgba(255,255,255,.5)', fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit' }}>✕</button>
          </div>
        </div>
        <div style={{ padding:'8px 18px 10px', borderBottom:'1px solid rgba(255,255,255,.07)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
            <span style={{ fontSize:11, opacity:.35, fontWeight:600 }}>Level progress</span>
            <span style={{ fontSize:11, fontWeight:800, color:themeP }}>{stats.xpInLvl}/100 XP</span>
          </div>
          <Bar value={stats.xpInLvl} max={100} grad={grad}/>
        </div>
        <div style={{ display:'flex', gap:4, padding:'8px 18px', borderBottom:'1px solid rgba(255,255,255,.07)' }}>
          {[['profile',t('profile',lang),'👤'],['settings',t('settings',lang),'⚙️'],['data',t('data',lang),'💾']].map(([k,l,i]) => (
            <button key={k} onClick={() => setTab(k)} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2, padding:'7px 4px', borderRadius:10, border:'none', cursor:'pointer', fontFamily:'inherit', background:tab===k?`${themeP}22`:'transparent', color:tab===k?themeP:'rgba(255,255,255,.35)', transition:'all .2s' }}>
              <span style={{ fontSize:15 }}>{i}</span><span style={{ fontSize:10, fontWeight:700 }}>{l}</span>
            </button>
          ))}
        </div>
        <div className="ns" style={{ flex:1, overflowY:'auto', padding:'16px 18px 32px' }}>
          {tab === 'profile' && (
            <div className="fu" style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div><label style={{ display:'block', fontSize:10, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>{t('name',lang)}</label>
                <input value={user.name} maxLength={24} onChange={e => onUser({ name:e.target.value })} style={inp}/>
              </div>
              <div><label style={{ display:'block', fontSize:10, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>{t('bio',lang)}</label>
                <input value={user.bio||''} maxLength={80} onChange={e => onUser({ bio:e.target.value })} placeholder="Tell about yourself…" style={{ ...inp, color:'rgba(255,255,255,.7)' }}/>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
                {[[t('watched',lang),stats.watched,'✅'],['Hours',stats.hours,'⏱'],['Rated',stats.rated,'★']].map(([l,v,i]) => (
                  <div key={l} style={{ borderRadius:13, padding:'12px 8px', textAlign:'center', background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.07)' }}>
                    <span style={{ fontSize:18, display:'block', marginBottom:3 }}>{i}</span>
                    <p className="syne" style={{ fontSize:18, fontWeight:800 }}>{fmt(v)}</p>
                    <p style={{ fontSize:10, opacity:.35, fontWeight:600 }}>{l}</p>
                  </div>
                ))}
              </div>
              <button onClick={() => { onSave(); onClose(); }} className="btn-p" style={{ padding:13, borderRadius:13, fontSize:14, boxShadow:`0 8px 24px ${themeP}44` }}>💾 {t('save',lang)}</button>
              <button onClick={onLogout} className="btn-g" style={{ padding:11, borderRadius:12, fontSize:13, border:'1px solid rgba(239,68,68,.3)', color:'#f87171', background:'rgba(239,68,68,.09)' }}>🚪 {t('logout',lang)}</button>
            </div>
          )}
          {tab === 'settings' && (
            <div className="fu" style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div>
                <p style={{ fontSize:11, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>{t('theme',lang)}</p>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:7 }}>
                  {Object.entries(THEMES).map(([k,th]) => {
                    const active = curTheme===k;
                    return <button key={k} onClick={() => onTheme(k)} style={{ padding:'10px 4px', borderRadius:13, border:`1.5px solid ${active?th.p:'rgba(255,255,255,.07)'}`, background:active?`${th.p}22`:'rgba(255,255,255,.04)', cursor:'pointer', textAlign:'center', fontFamily:'inherit', transition:'all .2s', transform:active?'scale(1.07)':'scale(1)' }}>
                      <div style={{ fontSize:17, marginBottom:3 }}>{th.i}</div>
                      <p style={{ fontSize:10, fontWeight:700, color:active?th.p:'rgba(255,255,255,.4)', margin:0 }}>{th.n}</p>
                    </button>;
                  })}
                </div>
              </div>
              <div>
                <p style={{ fontSize:11, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>{t('language',lang)}</p>
                <div style={{ display:'flex', gap:7 }}>
                  {[['uz','🇺🇿 UZ'],['ru','🇷🇺 RU'],['en','🇺🇸 EN']].map(([l,lbl]) => (
                    <button key={l} onClick={() => onLang(l)} style={{ flex:1, padding:'10px', borderRadius:12, border:`1.5px solid ${lang===l?themeP:'rgba(255,255,255,.1)'}`, background:lang===l?`${themeP}22`:'rgba(255,255,255,.05)', color:lang===l?themeP:'rgba(255,255,255,.45)', cursor:'pointer', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>{lbl}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {tab === 'data' && (
            <div className="fu" style={{ display:'flex', flexDirection:'column', gap:11 }}>
              <div style={{ padding:14, borderRadius:14, background:'rgba(34,197,94,.06)', border:'1px solid rgba(34,197,94,.2)' }}>
                <p style={{ fontSize:12, fontWeight:700, color:'#22c55e', marginBottom:5 }}>✓ Supabase Sync Active</p>
                <p style={{ fontSize:11, opacity:.5, lineHeight:1.55 }}>Your data is synced. Sign in on any device to restore.</p>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={onExport} className="btn-g" style={{ flex:1, padding:12, borderRadius:12, fontSize:12 }}>💾 {t('export',lang)}</button>
                <label style={{ flex:1, cursor:'pointer' }}>
                  <input type="file" onChange={onImport} accept=".json" style={{ display:'none' }}/>
                  <div className="btn-g" style={{ padding:12, borderRadius:12, fontSize:12, fontWeight:700, textAlign:'center', cursor:'pointer', border:'1px solid rgba(255,255,255,.1)' }}>📥 {t('import',lang)}</div>
                </label>
              </div>
              <button onClick={onResetCfg} style={{ padding:10, borderRadius:12, border:'1px solid rgba(249,115,22,.3)', background:'rgba(249,115,22,.07)', color:'#fb923c', cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:'inherit' }}>⚙ Reset Supabase Config</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════
   SETUP SCREEN
═══════════════════════════════════════════════ */
const SetupScreen = memo(({ onSave }) => {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [step, setStep] = useState(0);

  const SQL = `create table if not exists cinehub_data (
  user_id    uuid references auth.users on delete cascade primary key,
  data       jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table cinehub_data enable row level security;
create policy "ch_select" on cinehub_data for select using (auth.uid()=user_id);
create policy "ch_insert" on cinehub_data for insert with check (auth.uid()=user_id);
create policy "ch_update" on cinehub_data for update using (auth.uid()=user_id);`;

  const inp = { width:'100%', padding:'12px 14px', borderRadius:12, border:'1.5px solid rgba(255,255,255,.12)', background:'rgba(255,255,255,.06)', color:'white', fontSize:13, fontWeight:500, outline:'none', fontFamily:'inherit', transition:'all .2s' };

  const handleSave = () => {
    if (!url.startsWith('https://') || !url.includes('supabase.co')) { setErr('Invalid URL (https://xxx.supabase.co)'); return; }
    if (key.length < 30) { setErr('Key is too short'); return; }
    const cfg = { url:url.trim(), key:key.trim() };
    saveCfg(cfg); onSave(cfg);
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'#050507', display:'flex', alignItems:'center', justifyContent:'center', padding:20, fontFamily:'DM Sans,system-ui,sans-serif', zIndex:99999, overflow:'auto' }}>
      <div style={{ width:'100%', maxWidth:500, display:'flex', flexDirection:'column', gap:20 }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ width:72, height:72, borderRadius:22, background:'linear-gradient(135deg,#6366f1,#4f46e5)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', boxShadow:'0 0 40px #6366f166' }}>
            <span style={{ fontSize:30 }}>🎬</span>
          </div>
          <h1 className="syne" style={{ fontSize:30, fontWeight:800, color:'white', marginBottom:6 }}>CineHub Setup</h1>
          <p style={{ fontSize:13, color:'rgba(255,255,255,.35)' }}>Connect your Supabase backend</p>
        </div>
        <div style={{ display:'flex', gap:6, borderRadius:14, background:'rgba(255,255,255,.05)', padding:5 }}>
          {[['🗄 SQL Tables',0],['🔑 API Config',1]].map(([l,s]) => (
            <button key={s} onClick={() => setStep(s)} style={{ flex:1, padding:'10px', borderRadius:10, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:700, transition:'all .2s', background:step===s?'linear-gradient(135deg,#6366f1,#4f46e5)':'transparent', color:step===s?'white':'rgba(255,255,255,.4)' }}>{l}</button>
          ))}
        </div>
        {step === 0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ padding:16, borderRadius:14, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)' }}>
              <p style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.7)', marginBottom:10 }}>Run this SQL in Supabase → SQL Editor:</p>
              <div style={{ position:'relative' }}>
                <pre style={{ fontSize:11, lineHeight:1.7, color:'#4ade80', background:'rgba(0,0,0,.5)', padding:14, borderRadius:12, overflowX:'auto', border:'1px solid rgba(74,222,128,.2)', fontFamily:'monospace', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{SQL}</pre>
                <button onClick={() => navigator.clipboard?.writeText(SQL)} style={{ position:'absolute', top:8, right:8, padding:'4px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,.15)', background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.6)', cursor:'pointer', fontSize:11, fontWeight:700, fontFamily:'inherit' }}>Copy</button>
              </div>
            </div>
            <button onClick={() => setStep(1)} className="btn-p" style={{ padding:13, borderRadius:13, fontSize:14 }}>Next → API Config</button>
          </div>
        )}
        {step === 1 && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {err && <div style={{ padding:'10px 13px', borderRadius:12, background:'#ef444418', color:'#f87171', fontSize:13, fontWeight:600 }}>{err}</div>}
            <div>
              <label style={{ display:'block', fontSize:10, fontWeight:700, opacity:.4, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>Project URL</label>
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://xxxxx.supabase.co" style={inp}/>
            </div>
            <div>
              <label style={{ display:'block', fontSize:10, fontWeight:700, opacity:.4, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>Anon Public Key</label>
              <input value={key} onChange={e => setKey(e.target.value)} placeholder="eyJhbGciOiJIUzI1NiIs…" style={{ ...inp, fontFamily:'monospace', fontSize:11 }}/>
            </div>
            <button onClick={handleSave} className="btn-p" style={{ padding:14, borderRadius:13, fontSize:14 }}>🚀 Launch CineHub</button>
          </div>
        )}
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════
   AUTH FORM
═══════════════════════════════════════════════ */
const AuthForm = memo(({ sb, themeP, onSuccess }) => {
  const [mode, setMode]     = useState('login');
  const [email, setEmail]   = useState('');
  const [pass, setPass]     = useState('');
  const [name, setName]     = useState('');
  const [loading, setLd]    = useState(false);
  const [err, setErr]       = useState('');
  const [showPw, setShowPw] = useState(false);

  const inp = { width:'100%', padding:'12px 14px', borderRadius:12, border:'1.5px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.07)', color:'white', fontSize:14, fontWeight:500, outline:'none', fontFamily:'inherit', transition:'all .2s' };

  const doLogin = async () => {
    setErr(''); if (!email.includes('@') || pass.length < 6) { setErr('Check email and password'); return; }
    setLd(true);
    try {
      const r = await sb.signIn(email, pass);
      if (r?.access_token) {
        const s = { access_token:r.access_token, refresh_token:r.refresh_token, user_id:r.user?.id, email:r.user?.email, expires_at:Date.now()+3600*1000 };
        LS.set(SESS_KEY, JSON.stringify(s)); onSuccess(r);
      } else setErr(r?.error_description || 'Wrong email or password');
    } catch { setErr('Connection error'); } finally { setLd(false); }
  };

  const doRegister = async () => {
    setErr(''); if (!name.trim()) { setErr('Enter your name'); return; }
    if (!email.includes('@') || pass.length < 6) { setErr('Check email and password'); return; }
    setLd(true);
    try {
      const r = await sb.signUp(email, pass, name);
      if (r?.access_token) {
        const s = { access_token:r.access_token, refresh_token:r.refresh_token, user_id:r.user?.id, email:r.user?.email, expires_at:Date.now()+3600*1000 };
        LS.set(SESS_KEY, JSON.stringify(s)); onSuccess(r);
      } else {
        if (r?.user?.id) { setErr('📧 Check email to confirm, then sign in.'); }
        else setErr(r?.error_description || 'Registration failed');
      }
    } catch { setErr('Connection error'); } finally { setLd(false); }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:13 }}>
      <div style={{ display:'flex', gap:4, borderRadius:12, background:'rgba(255,255,255,.06)', padding:4 }}>
        {[['login','Sign In'],['register','Register']].map(([m,l]) => (
          <button key={m} onClick={() => { setMode(m); setErr(''); }} style={{ flex:1, padding:'9px', borderRadius:9, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:13, fontWeight:700, transition:'all .2s', background:mode===m?`linear-gradient(135deg,${themeP},${themeP}99)`:'transparent', color:mode===m?'#000':'rgba(255,255,255,.4)' }}>{l}</button>
        ))}
      </div>
      {err && <div style={{ padding:'10px 13px', borderRadius:11, background:'#ef444418', color:'#f87171', fontSize:13, fontWeight:600 }}>{err}</div>}
      {mode==='register' && (
        <div>
          <label style={{ display:'block', fontSize:10, fontWeight:700, opacity:.4, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" style={inp}/>
        </div>
      )}
      <div>
        <label style={{ display:'block', fontSize:10, fontWeight:700, opacity:.4, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@email.com" style={inp} onKeyDown={e => e.key==='Enter' && (mode==='login'?doLogin():doRegister())}/>
      </div>
      <div style={{ position:'relative' }}>
        <label style={{ display:'block', fontSize:10, fontWeight:700, opacity:.4, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>Password</label>
        <input type={showPw?'text':'password'} value={pass} onChange={e => setPass(e.target.value)} placeholder="Min 6 characters" style={{ ...inp, paddingRight:44 }} onKeyDown={e => e.key==='Enter' && (mode==='login'?doLogin():doRegister())}/>
        <button type="button" onClick={() => setShowPw(x => !x)} style={{ position:'absolute', bottom:12, right:12, background:'none', border:'none', cursor:'pointer', fontSize:16, opacity:.4, color:'white', padding:0 }}>{showPw?'🙈':'👁'}</button>
      </div>
      <button onClick={mode==='login'?doLogin:doRegister} className="btn-p" disabled={loading} style={{ padding:14, borderRadius:13, fontSize:14, opacity:loading?.7:1 }}>
        {loading ? <Spinner size={18} color="#000"/> : mode==='login' ? '🔐 Sign In' : '✨ Create Account'}
      </button>
    </div>
  );
});

/* ═══════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════ */
export default function App() {
  const [sbCfg, setSbCfg] = useState(() => loadCfg());
  const sb = useMemo(() => sbCfg ? mkSB(sbCfg.url, sbCfg.key) : null, [sbCfg]);

  const [session,  setSession]  = useState(null);
  const [isAuth,   setIsAuth]   = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [profOpen, setProfOpen] = useState(false);
  const [syncSt,   setSyncSt]   = useState('idle');

  const [user,       setUser]       = useState(() => ({ name:'Guest', bio:'Welcome to CineHub!', avatar:`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=cinehub`, xp:0, joinDate:new Date().toISOString(), email:'' }));
  const [library,    setLibrary]    = useState({});
  const [ratings,    setRatings]    = useState({});
  const [favs,       setFavs]       = useState([]);
  const [wl,         setWl]         = useState([]);
  const [notes,      setNotes]      = useState({});
  const [histD,      setHistD]      = useState([]);
  const [achs,       setAchs]       = useState([]);
  const [shareCount, setShareCount] = useState(0);
  const [xpToday,    setXpToday]    = useState({});

  const [boot,       setBoot]       = useState(true);
  const [curView,    setCurView]    = useState('home');
  const [curTheme,   setCurTheme]   = useState('noir');
  const [lang,       setLang]       = useState('en');
  const [playerSrc,  setPlayerSrc]  = useState('kodik');
  const [selMovie,   setSelMovie]   = useState(null);
  const [toasts,     setToasts]     = useState([]);
  const [achPop,     setAchPop]     = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters,    setFilters]    = useState({ genre:'', year:null, ratingMin:0, quality:'' });
  const [sort,       setSort]       = useState('rating');
  const [page,       setPage]       = useState(1);
  const [logoutDlg,  setLogoutDlg]  = useState(false);
  const [vMode,      setVMode]      = useState('grid');

  const [popular,    setPopular]    = useState([]);
  const [latest,     setLatest]     = useState([]);
  const [topRated,   setTopRated]   = useState([]);
  const [browse,     setBrowse]     = useState([]);
  const [browseTotal,setBrowseTotal]= useState(0);
  const [loadBr,     setLoadBr]     = useState(false);
  const [homeLoaded, setHomeLoaded] = useState(false);

  const fileRef  = useRef(null);
  const saveRef  = useRef(null);
  const achsRef  = useRef([]);
  const theme    = THEMES[curTheme] ?? THEMES.noir;

  const setView = useCallback((v) => setCurView(v), []);

  /* Boot */
  useEffect(() => { const ti = setTimeout(() => setBoot(false), 1400); return () => clearTimeout(ti); }, []);

  /* CSS */
  useEffect(() => {
    let el = document.getElementById('ch-css');
    if (!el) { el = document.createElement('style'); el.id = 'ch-css'; document.head.appendChild(el); }
    el.textContent = buildCSS(theme.p, theme.s, theme.b, theme.m);
    document.body.style.background = theme.b;
  }, [curTheme, theme]);

  /* Keyboard */
  useEffect(() => {
    const h = e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(x => !x); }
      if (e.key === 'Escape') { setSearchOpen(false); setFilterOpen(false); setSelMovie(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  /* Toast */
  const toast = useCallback((msg, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p.slice(-3), { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);

  /* XP */
  const addXP = useCallback((amt, key) => {
    if (!isAuth) return;
    const k = `${key}_${today()}`;
    if (xpToday[k]) return;
    setXpToday(p => ({ ...p, [k]:true }));
    setUser(p => ({ ...p, xp:p.xp + amt }));
  }, [isAuth, xpToday]);

  /* Achievements */
  const unlockAch = useCallback((id) => {
    if (!isAuth) return;
    if (achsRef.current.includes(id)) return;
    setAchs(prev => {
      if (prev.includes(id)) return prev;
      achsRef.current = [...prev, id];
      const a = ACHS.find(x => x.id === id); if (!a) return prev;
      setUser(u => ({ ...u, xp:u.xp + a.xp }));
      setAchPop(a); setTimeout(() => setAchPop(null), 4500);
      return [...prev, id];
    });
  }, [isAuth]);

  /* Stats */
  const stats = useMemo(() => {
    const lv  = Math.floor(user.xp / 100) + 1;
    const lv2 = Object.values(library);
    const rv  = Object.values(ratings);
    const rated = rv.length;
    const avg   = rated ? (rv.reduce((a, b) => a + b, 0) / rated).toFixed(1) : '—';
    return {
      level:lv, xpInLvl:user.xp%100,
      watched:  lv2.filter(x => x.status==='completed').length,
      watching: lv2.filter(x => x.status==='watching').length,
      planned:  lv2.filter(x => x.status==='planned').length,
      rated, avgRating:avg,
      hours:    Math.round(lv2.filter(x => x.status==='completed').length * 1.8),
      notes:    Object.values(notes).filter(n => n).length,
      perf10:   rv.filter(r => r === 10).length,
      libSize:  lv2.length,
      genreSet: new Set(lv2.filter(x => x.status==='completed').flatMap(x => x.genres ?? [])).size,
    };
  }, [user.xp, library, ratings, notes]);

  /* Ach triggers */
  useEffect(() => {
    if (!isAuth) return;
    if (stats.watched >= 1)   unlockAch('first');
    if (stats.rated >= 10)    unlockAch('rate10');
    if (stats.watched >= 50)  unlockAch('comp50');
    if (favs.length >= 20)    unlockAch('fav20');
    if (stats.notes >= 10)    unlockAch('notes10');
    if (stats.libSize >= 100) unlockAch('lib100');
    if (shareCount >= 5)      unlockAch('share5');
    if (stats.perf10 >= 10)   unlockAch('perf10');
    if (stats.genreSet >= 5)  unlockAch('genres5');
    const h = new Date().getHours();
    if (h < 3) unlockAch('night');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, isAuth, favs.length, shareCount]);

  /* Home content */
  useEffect(() => {
    setPopular([]); setLatest([]); setTopRated([]); setHomeLoaded(false);
    (async () => {
      try {
        const [d1, d2, d3] = await Promise.all([
          tmdbFetch('/movie/popular?page=1', lang),
          tmdbFetch('/movie/now_playing?page=1', lang),
          tmdbFetch('/movie/top_rated?page=1', lang),
        ]);
        const p  = (d1?.results ?? []).map(normalizeTMDB);
        const l  = (d2?.results ?? []).map(normalizeTMDB);
        const tr = (d3?.results ?? []).map(normalizeTMDB);
        setPopular(p); setLatest(l); setTopRated(tr);
        setHomeLoaded(true);
        p.slice(0, 8).forEach(m => preloadImg(m.medium_cover_image));
      } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  /* Browse path */
  const browsePathFor = useCallback((pg) => {
    const sortMap = { rating:'vote_average.desc', download_count:'popularity.desc', date_added:'release_date.desc', like_count:'vote_count.desc' };
    const tmdbSort = sortMap[sort] ?? 'popularity.desc';
    let path = `/discover/movie?page=${pg}&sort_by=${tmdbSort}&vote_count.gte=100`;
    if (filters.genre) { const gid = GENRE_TO_TMDB[filters.genre]; if (gid) path += `&with_genres=${gid}`; }
    if (filters.year)         path += `&primary_release_year=${filters.year}`;
    if (filters.ratingMin > 0) path += `&vote_average.gte=${filters.ratingMin}`;
    return path;
  }, [sort, filters]);

  useEffect(() => {
    if (curView !== 'browse') return;
    setLoadBr(true);
    tmdbFetch(browsePathFor(page), lang).then(d => {
      setBrowse((d?.results ?? []).map(normalizeTMDB));
      setBrowseTotal(d?.total_results ?? 0);
      setLoadBr(false);
    }).catch(() => setLoadBr(false));
  }, [curView, page, browsePathFor, lang]);

  /* Auth helpers */
  const applyUserData = useCallback((data) => {
    if (!data) return;
    if (data.user)     setUser(data.user);
    if (data.library)  setLibrary(data.library);
    if (data.ratings)  setRatings(data.ratings);
    const la = data.achs ?? []; achsRef.current = la; setAchs(la);
    if (data.favs)     setFavs(data.favs);
    if (data.wl)       setWl(data.wl);
    if (data.notes)    setNotes(data.notes);
    if (data.history)  setHistD(data.history);
    if (data.theme)    setCurTheme(data.theme);
    if (data.lang)     setLang(data.lang);
    if (data.shareCount) setShareCount(data.shareCount);
  }, []);

  const onAuthSuccess = useCallback(async (r) => {
    const sess = LS.json(SESS_KEY);
    if (!sess) return;
    setSession(sess); setIsAuth(true); setAuthOpen(false);
    const nm = r.user?.user_metadata?.display_name || r.user?.email?.split('@')[0] || 'CineHub Fan';
    try {
      const data = await sb.getData(sess.access_token, sess.user_id);
      if (data) { applyUserData(data); toast(`Welcome back, ${data.user?.name || nm}! 🎬`); }
      else { setUser(p => ({ ...p, name:nm, email:r.user?.email||'' })); toast(`Welcome, ${nm}! 🎬`); }
    } catch {}
  }, [sb, applyUserData, toast]);

  useEffect(() => {
    if (!sb) return;
    (async () => {
      const sess = LS.json(SESS_KEY);
      if (!sess?.access_token) return;
      if (sess.expires_at && Date.now() > sess.expires_at - 60000) {
        try {
          const nr = await sb.refreshToken(sess.refresh_token);
          if (nr?.access_token) {
            const ns = { ...sess, access_token:nr.access_token, refresh_token:nr.refresh_token, expires_at:Date.now()+3600*1000 };
            LS.set(SESS_KEY, JSON.stringify(ns)); setSession(ns); setIsAuth(true);
            const data = await sb.getData(ns.access_token, ns.user_id);
            if (data) applyUserData(data); return;
          }
        } catch {}
        LS.del(SESS_KEY); return;
      }
      setSession(sess); setIsAuth(true);
      try { const data = await sb.getData(sess.access_token, sess.user_id); if (data) applyUserData(data); } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb]);

  /* Save */
  const latestRef = useRef({});
  useEffect(() => { latestRef.current = { isAuth, session, sb, user, library, ratings, favs, wl, notes, histD, achs, curTheme, lang, shareCount }; });

  const save = useCallback(async () => {
    const d = latestRef.current;
    if (!d.isAuth || !d.session || !d.sb) return;
    const payload = { user:d.user, library:d.library, ratings:d.ratings, favs:d.favs, wl:d.wl, notes:d.notes, history:d.histD, achs:d.achs, theme:d.curTheme, lang:d.lang, shareCount:d.shareCount };
    setSyncSt('syncing');
    try { const ok = await d.sb.upsertData(d.session.access_token, d.session.user_id, payload); setSyncSt(ok ? 'synced' : 'error'); }
    catch { setSyncSt('error'); }
    setTimeout(() => setSyncSt('idle'), 2500);
  }, []);

  useEffect(() => {
    if (!isAuth || !session) return;
    clearTimeout(saveRef.current);
    saveRef.current = setTimeout(save, SAVE_DELAY);
    return () => clearTimeout(saveRef.current);
  }, [user, library, ratings, favs, wl, notes, histD, achs, curTheme, lang, isAuth, session]);

  /* Logout */
  const doLogout = useCallback(async () => {
    if (session?.access_token && sb) { try { await sb.signOut(session.access_token); } catch {} }
    LS.del(SESS_KEY);
    setSession(null); setIsAuth(false);
    setUser({ name:'Guest', bio:'Welcome to CineHub!', avatar:`https://api.dicebear.com/9.x/bottts-neutral/svg?seed=cinehub`, xp:0, joinDate:new Date().toISOString(), email:'' });
    setLibrary({}); setRatings({}); setFavs([]); setWl([]); setNotes({}); setHistD([]); setAchs([]);
    setLogoutDlg(false); setProfOpen(false);
    toast('Goodbye! 👋', 'info');
  }, [session, sb, toast]);

  /* Movie actions */
  const openMovie = useCallback((movie) => {
    setSelMovie(movie);
    setHistD(p => [{ ...movie, viewedAt:new Date().toLocaleString() }, ...p.filter(h => h.id !== movie.id)].slice(0, 100));
    if (isAuth) addXP(3, `view_${movie.id}`);
  }, [isAuth, addXP]);

  const handleStatus = useCallback((movie, status) => {
    if (!isAuth) { setAuthOpen(true); return; }
    setLibrary(p => {
      const was = p[movie.id]?.status;
      addXP(status==='completed' && was!=='completed' ? 30 : 8, `lib_${movie.id}_${status}`);
      return { ...p, [movie.id]:{ ...movie, status, addedDate:new Date().toISOString() } };
    });
    toast({ watching:t('watching',lang), planned:t('planned',lang), completed:t('watched',lang) }[status]);
  }, [isAuth, addXP, toast, lang]);

  const handleRate = useCallback((movie, score) => {
    if (!isAuth) { setAuthOpen(true); return; }
    setRatings(p => ({ ...p, [movie.id]:score }));
    addXP(6, `rate_${movie.id}`);
    toast(`★ ${score}/10`);
  }, [isAuth, addXP, toast]);

  const handleFav = useCallback((movie) => {
    if (!isAuth) { setAuthOpen(true); return; }
    setFavs(p => {
      const has = p.some(f => f.id === movie.id);
      toast(has ? 'Removed from favorites' : '❤ Added to favorites', has ? 'info' : 'success');
      if (!has) addXP(5, `fav_${movie.id}`);
      return has ? p.filter(f => f.id !== movie.id) : [...p, { ...movie, favDate:new Date().toISOString() }];
    });
  }, [isAuth, addXP, toast]);

  const handleWL = useCallback((movie) => {
    if (!isAuth) { setAuthOpen(true); return; }
    setWl(p => {
      const has = p.some(w => w.id === movie.id);
      toast(has ? 'Removed from watchlist' : '+ Added to watchlist', has ? 'info' : 'success');
      if (!has) addXP(3, `wl_${movie.id}`);
      return has ? p.filter(w => w.id !== movie.id) : [...p, { ...movie, wlDate:new Date().toISOString() }];
    });
  }, [isAuth, addXP, toast]);

  const handleNote = useCallback((id, text) => {
    if (!isAuth) return;
    setNotes(p => ({ ...p, [id]:text }));
    addXP(2, `note_${id}`);
  }, [isAuth, addXP]);

  const handleShare = useCallback((movie) => {
    const url = `https://www.imdb.com/title/${movie.imdb_code}`;
    if (navigator.share) navigator.share({ title:movie.title, url }).catch(()=>{});
    else navigator.clipboard?.writeText(url).then(() => toast('Link copied! 📋')).catch(() => toast('Copy failed','error'));
    if (isAuth) { setShareCount(x => x + 1); addXP(2, `share_${movie.id}`); }
  }, [isAuth, addXP, toast]);

  const randomMovie = useCallback(() => {
    const pool = popular.length ? popular : topRated;
    if (!pool.length) return;
    openMovie(pool[Math.floor(Math.random() * pool.length)]);
    toast('🎲 Random movie!');
  }, [popular, topRated, openMovie, toast]);

  const doExport = useCallback(() => {
    if (!isAuth) { toast('Sign in first','warning'); return; }
    const blob = new Blob([JSON.stringify({ user, library, ratings, favs, wl, notes, history:histD, achs, theme:curTheme })], { type:'application/json' });
    const a = Object.assign(document.createElement('a'), { href:URL.createObjectURL(blob), download:`cinehub-${Date.now()}.json` });
    a.click(); URL.revokeObjectURL(a.href); toast('Exported! 💾');
  }, [isAuth, user, library, ratings, favs, wl, notes, histD, achs, curTheme, toast]);

  const doImport = useCallback((e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.user) setUser(d.user); if (d.library) setLibrary(d.library);
        if (d.ratings) setRatings(d.ratings); if (d.favs) setFavs(d.favs);
        if (d.wl) setWl(d.wl); if (d.notes) setNotes(d.notes);
        if (d.achs) setAchs(d.achs); if (d.theme) setCurTheme(d.theme);
        toast('Imported! ✅');
      } catch { toast('Import failed','error'); }
    };
    r.readAsText(f);
  }, [toast]);

  /* Derived */
  const favIds = useMemo(() => new Set(favs.map(f => f.id)), [favs]);
  const wlIds  = useMemo(() => new Set(wl.map(w => w.id)), [wl]);
  const hasFilters = filters.genre || filters.year || filters.ratingMin > 0;
  const hasMore    = browse.length === PER_PAGE;

  const dpProps = useMemo(() => ({
    lib:library, ratings, notes, favs:favIds, wl:wlIds, themeP:theme.p, isAuth,
    onStatus:handleStatus, onRate:handleRate, onNote:handleNote, onFav:handleFav, onWL:handleWL, onShare:handleShare,
    lang, playerSrc, onPlayerChange: setPlayerSrc,
  }), [library, ratings, notes, favIds, wlIds, theme.p, isAuth, handleStatus, handleRate, handleNote, handleFav, handleWL, handleShare, lang, playerSrc]);

  const displayData = useMemo(() => {
    if (curView==='library')   return Object.values(library);
    if (curView==='favs')      return favs;
    if (curView==='watchlist') return wl;
    if (curView==='history')   return histD;
    if (curView==='browse')    return browse;
    return [];
  }, [curView, library, favs, wl, histD, browse]);

  /* ════ SETUP ════ */
  if (!sbCfg) return <SetupScreen onSave={cfg => setSbCfg(cfg)}/>;

  /* ════ BOOT ════ */
  if (boot) return (
    <div style={{ position:'fixed', inset:0, background:theme.b, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:28, fontFamily:'DM Sans,system-ui,sans-serif' }}>
      <div style={{ position:'relative', width:100, height:100 }}>
        <div style={{ position:'absolute', inset:0, borderRadius:28, background:`conic-gradient(${theme.p},${theme.s},#a855f7,${theme.p})`, animation:'spin 2s linear infinite' }}/>
        <div style={{ position:'absolute', inset:4, borderRadius:24, background:theme.b, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ fontSize:36 }}>🎬</span>
        </div>
      </div>
      <div style={{ textAlign:'center' }}>
        <p className="syne" style={{ fontSize:38, fontWeight:800, background:`linear-gradient(135deg,${theme.p},#fff,${theme.s})`, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', margin:'0 0 6px' }}>CineHub</p>
        <p style={{ fontSize:12, color:'rgba(255,255,255,.28)' }}>Premium Movie Platform</p>
      </div>
    </div>
  );

  const NAV = [
    { k:'home',      l:t('home',lang),       i:'🏠' },
    { k:'browse',    l:t('browse',lang),      i:'🎬' },
    { k:'favs',      l:t('favs',lang),        i:'❤️' },
    { k:'watchlist', l:t('watchlist',lang),   i:'🔖' },
    { k:'library',   l:t('library',lang),     i:'📚' },
    { k:'history',   l:t('history',lang),     i:'🕐' },
    { k:'stats',     l:t('stats',lang),       i:'📊' },
  ];

  return (
    <div style={{ minHeight:'100dvh', background:theme.b, overflowX:'hidden', position:'relative' }}>
      <div className="noise"/>
      <div className="film-grain"/>
      <div style={{ position:'fixed', top:0, left:'50%', transform:'translateX(-50%)', width:800, height:400, background:`radial-gradient(ellipse,${theme.p}0f 0%,transparent 70%)`, pointerEvents:'none', zIndex:0 }}/>

      <Toasts items={toasts}/>

      {/* Achievement popup */}
      {achPop && (
        <div className="ap" style={{ position:'fixed', bottom:90, right:14, zIndex:9700, maxWidth:280, width:'calc(100vw - 28px)' }}>
          <div className="glass-dark" style={{ borderRadius:18, padding:14, border:`1.5px solid ${theme.p}55`, boxShadow:`0 20px 60px rgba(0,0,0,.7)` }}>
            <p style={{ fontSize:10, fontWeight:700, opacity:.35, textTransform:'uppercase', letterSpacing:'.09em', marginBottom:9 }}>🏆 {t('achievements',lang)}!</p>
            <div style={{ display:'flex', alignItems:'center', gap:11 }}>
              <div style={{ width:46, height:46, borderRadius:13, background:`linear-gradient(135deg,${theme.p},${theme.s})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, boxShadow:`0 6px 20px ${theme.p}55`, flexShrink:0 }}>{achPop.e}</div>
              <div>
                <p className="syne" style={{ fontSize:14, fontWeight:700, marginBottom:2 }}>{achPop.n[lang]||achPop.n.en}</p>
                <p style={{ fontSize:12, fontWeight:800, color:theme.p }}>+{achPop.xp} XP</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overlays */}
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} themeP={theme.p} onOpen={openMovie} lang={lang}/>}
      {filterOpen && <FilterPanel filters={filters} onChange={f => { setFilters(f); setPage(1); }} themeP={theme.p} onClose={() => setFilterOpen(false)} lang={lang}/>}
      {selMovie && <ItemModal movie={selMovie} onClose={() => setSelMovie(null)} {...dpProps}/>}

      {profOpen && isAuth && (
        <ProfileSheet user={user} stats={stats} achs={achs} themeP={theme.p} themeS={theme.s} syncSt={syncSt} curTheme={curTheme} lang={lang}
          onClose={() => setProfOpen(false)} onSave={save} onLogout={() => { setProfOpen(false); setLogoutDlg(true); }}
          onExport={doExport} onImport={doImport} onUser={d => setUser(p => ({ ...p, ...d }))}
          onTheme={setCurTheme} onLang={setLang}
          onResetCfg={() => { saveCfg(null); setSbCfg(null); }}
          fileRef={fileRef}/>
      )}

      {authOpen && (
        <div className="fi" style={{ position:'fixed', inset:0, zIndex:9500, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.82)', backdropFilter:'blur(18px)' }} onClick={() => setAuthOpen(false)}/>
          <div className="glass-dark su page-sheet" style={{ position:'relative', padding:'20px 20px 38px', boxShadow:'0 -24px 70px rgba(0,0,0,.75)' }}>
            <div style={{ display:'flex', justifyContent:'center', marginBottom:10 }}><div style={{ width:30, height:4, borderRadius:99, background:'rgba(255,255,255,.2)' }}/></div>
            <div style={{ display:'flex', alignItems:'center', gap:13, marginBottom:20 }}>
              <div style={{ width:46, height:46, borderRadius:13, background:`linear-gradient(135deg,${theme.p},${theme.s})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>🔐</div>
              <div>
                <p className="syne" style={{ fontSize:18, fontWeight:700, marginBottom:2 }}>{t('login',lang)} / {t('register',lang)}</p>
                <p style={{ fontSize:12, opacity:.35 }}>Sync across devices</p>
              </div>
              <button onClick={() => setAuthOpen(false)} style={{ marginLeft:'auto', width:28, height:28, borderRadius:9, border:'none', background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.5)', cursor:'pointer', fontSize:13, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit' }}>✕</button>
            </div>
            <AuthForm sb={sb} themeP={theme.p} onSuccess={onAuthSuccess}/>
          </div>
        </div>
      )}

      {logoutDlg && (
        <div className="fi" style={{ position:'fixed', inset:0, zIndex:9600, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 20px', background:'rgba(0,0,0,.88)', backdropFilter:'blur(18px)' }}>
          <div className="glass-dark si" style={{ borderRadius:22, padding:'28px 24px', textAlign:'center', maxWidth:300, width:'100%' }}>
            <div style={{ width:52, height:52, borderRadius:16, margin:'0 auto 14px', background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>🚪</div>
            <p className="syne" style={{ fontSize:18, fontWeight:700, marginBottom:7 }}>{t('logout',lang)}?</p>
            <p style={{ fontSize:12, opacity:.35, marginBottom:22 }}>Your data is saved.</p>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setLogoutDlg(false)} className="btn-g" style={{ flex:1, padding:12, borderRadius:12, fontSize:13 }}>Cancel</button>
              <button onClick={doLogout} className="btn-p" style={{ flex:1, padding:12, borderRadius:12, fontSize:13, background:'linear-gradient(135deg,#ef4444,#dc2626)', boxShadow:'0 8px 22px rgba(239,68,68,.4)' }}>Sign Out</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ HEADER ═══ */}
      <header style={{ position:'sticky', top:0, zIndex:700, background:`${theme.b}ee`, backdropFilter:'blur(28px) saturate(200%)', borderBottom:'1px solid rgba(255,255,255,.07)' }}>
        <div style={{ maxWidth:1800, margin:'0 auto', padding:'0 16px', height:58, display:'flex', alignItems:'center', gap:10 }}>
          <div onClick={() => { setView('home'); setFilters({ genre:'', year:null, ratingMin:0, quality:'' }); setPage(1); }} style={{ display:'flex', alignItems:'center', gap:9, cursor:'pointer', flexShrink:0 }}>
            <div style={{ width:36, height:36, borderRadius:11, background:`linear-gradient(135deg,${theme.p},${theme.s})`, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 0 18px ${theme.p}55`, animation:'glow 4s ease infinite', flexShrink:0 }}>
              <span style={{ fontSize:18 }}>🎬</span>
            </div>
            <span className="syne" style={{ fontSize:20, fontWeight:800, background:`linear-gradient(135deg,${theme.p},#fff)`, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>CineHub</span>
          </div>

          <nav className="desk" style={{ gap:2 }}>
            {NAV.map(v => (
              <button key={v.k} onClick={() => { setView(v.k); if (v.k==='browse') setPage(1); }} style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 11px', borderRadius:10, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:700, transition:'all .2s', background:curView===v.k?`${theme.p}1e`:'transparent', color:curView===v.k?theme.p:'rgba(255,255,255,.38)', borderBottom:curView===v.k?`2px solid ${theme.p}`:'2px solid transparent' }}>
                <span>{v.i}</span>{v.l}
              </button>
            ))}
          </nav>

          <div onClick={() => setSearchOpen(true)} style={{ flex:1, maxWidth:420, margin:'0 10px', cursor:'pointer' }}>
            <div style={{ display:'flex', alignItems:'center', gap:9, padding:'9px 14px', borderRadius:12, background:'rgba(255,255,255,.07)', border:'1.5px solid rgba(255,255,255,.09)', transition:'all .2s' }}
              onMouseEnter={e => e.currentTarget.style.borderColor=theme.p+'55'}
              onMouseLeave={e => e.currentTarget.style.borderColor='rgba(255,255,255,.09)'}>
              <span style={{ fontSize:15 }}>🔍</span>
              <span style={{ fontSize:13, color:'rgba(255,255,255,.28)', flex:1 }}>{t('search',lang)}…</span>
              <kbd className="desk" style={{ fontSize:10, padding:'2px 7px', borderRadius:6, background:'rgba(255,255,255,.07)', color:'rgba(255,255,255,.25)', border:'1px solid rgba(255,255,255,.1)', flexShrink:0 }}>Ctrl+K</kbd>
            </div>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:7, flexShrink:0, marginLeft:'auto' }}>
            <button onClick={() => setFilterOpen(true)} style={{ width:36, height:36, borderRadius:11, border:`1px solid ${hasFilters?theme.p+'55':'rgba(255,255,255,.1)'}`, background:hasFilters?`${theme.p}18`:'rgba(255,255,255,.07)', cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .2s', color:hasFilters?theme.p:'rgba(255,255,255,.45)', position:'relative', fontFamily:'inherit' }}>
              ⚙{hasFilters && <div style={{ position:'absolute', top:4, right:4, width:6, height:6, borderRadius:'50%', background:theme.p }}/>}
            </button>
            <button onClick={randomMovie} className="desk" style={{ width:36, height:36, borderRadius:11, border:'1px solid rgba(255,255,255,.1)', background:'rgba(255,255,255,.07)', cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .2s', fontFamily:'inherit' }} title="Random">🎲</button>

            <div className="desk" style={{ display:'flex', borderRadius:10, overflow:'hidden', border:'1px solid rgba(255,255,255,.1)', flexShrink:0 }}>
              {['uz','ru','en'].map(l => (
                <button key={l} onClick={() => setLang(l)} style={{ width:30, height:30, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:10, fontWeight:800, transition:'all .2s', background:lang===l?`linear-gradient(135deg,${theme.p},${theme.s})`:'rgba(255,255,255,.05)', color:lang===l?'#000':'rgba(255,255,255,.38)' }}>{l.toUpperCase()}</button>
              ))}
            </div>

            {!isAuth ? (
              <button onClick={() => setAuthOpen(true)} className="btn-p" style={{ padding:'8px 16px', borderRadius:11, fontSize:13, boxShadow:`0 4px 16px ${theme.p}44` }}>{t('login',lang)}</button>
            ) : (
              <button onClick={() => setProfOpen(true)} style={{ background:'none', border:'none', padding:0, cursor:'pointer' }}>
                <img src={user.avatar} alt="" style={{ width:36, height:36, borderRadius:11, objectFit:'cover', border:`2px solid ${theme.p}`, boxShadow:`0 0 14px ${theme.p}55`, display:'block' }}/>
              </button>
            )}
          </div>
        </div>

        <div className="ns mob" style={{ overflowX:'auto', gap:5, padding:'5px 14px 8px', borderTop:'1px solid rgba(255,255,255,.06)' }}>
          {NAV.map(v => (
            <button key={v.k} onClick={() => setView(v.k)} style={{ flexShrink:0, display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:99, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:700, whiteSpace:'nowrap', transition:'all .2s', background:curView===v.k?`linear-gradient(135deg,${theme.p},${theme.s})`:'rgba(255,255,255,.07)', color:curView===v.k?'#000':'rgba(255,255,255,.38)', boxShadow:curView===v.k?`0 4px 12px ${theme.p}44`:'' }}>
              <span>{v.i}</span>{v.l}
            </button>
          ))}
        </div>
      </header>

      {/* Trending marquee */}
      {curView === 'home' && popular.length > 0 && (
        <div style={{ overflow:'hidden', margin:'8px 0 4px', position:'relative' }}>
          <div style={{ maxWidth:1800, margin:'0 auto', padding:'0 16px 4px', display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <p style={{ fontSize:11, fontWeight:700, opacity:.4 }}>🔥 {t('popular',lang)}</p>
            <button onClick={() => { setView('browse'); setPage(1); }} style={{ background:'none', border:'none', cursor:'pointer', color:theme.p, fontSize:11, fontWeight:700, fontFamily:'inherit' }}>See all →</button>
          </div>
          <div style={{ overflow:'hidden' }}>
            <div style={{ display:'flex', gap:8, paddingLeft:16, animation:'marquee 80s linear infinite', width:'max-content' }}
              onMouseEnter={e => e.currentTarget.style.animationPlayState='paused'}
              onMouseLeave={e => e.currentTarget.style.animationPlayState='running'}>
              {[...popular, ...popular].map((m, i) => (
                <div key={`mq-${m.id}-${i}`} onClick={() => openMovie(m)} style={{ flexShrink:0, width:88, cursor:'pointer' }}>
                  <div style={{ borderRadius:12, overflow:'hidden', aspectRatio:'2/3', background:'#0a0a14', position:'relative', transition:'transform .3s' }}
                    onMouseEnter={e => e.currentTarget.style.transform='scale(1.08)'}
                    onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}>
                    {m.medium_cover_image && <img src={m.medium_cover_image} alt="" loading="lazy" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>}
                    <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top,rgba(0,0,0,.85) 0%,transparent 55%)' }}/>
                    <div style={{ position:'absolute', top:5, left:5, padding:'2px 6px', borderRadius:6, fontSize:9, fontWeight:800, color:'#000', background:`${theme.p}cc` }}>#{i % popular.length + 1}</div>
                    <div style={{ position:'absolute', bottom:5, left:5, right:5 }}>
                      {m.rating > 0 && <span style={{ fontSize:9, color:'#fbbf24', fontWeight:800 }}>★{m.rating}</span>}
                      <p className="lc2 syne" style={{ fontSize:9, fontWeight:700, color:'white', lineHeight:1.2, marginTop:1 }}>{m.title}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ LAYOUT ═══ */}
      <div style={{ maxWidth:1800, margin:'0 auto', padding:'12px 16px', display:'flex', gap:14, alignItems:'flex-start', position:'relative', zIndex:2 }} className="main-area">

        {/* Sidebar */}
        <aside className="sidebar" style={{ width:210, flexShrink:0, position:'sticky', top:130 }}>
          <div className="card" style={{ borderRadius:20, padding:14, display:'flex', flexDirection:'column', gap:13 }}>
            <div>
              <p style={{ fontSize:9, fontWeight:800, opacity:.3, textTransform:'uppercase', letterSpacing:'.1em', marginBottom:8 }}>Sort By</p>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {[['download_count','🔥 Popular'],['rating','★ Top Rated'],['date_added','📅 Newest'],['like_count','👍 Most Voted']].map(([v,l]) => (
                  <button key={v} onClick={() => { setSort(v); setView('browse'); setPage(1); }} style={{ padding:'8px 10px', borderRadius:10, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:12, fontWeight:700, transition:'all .2s', background:sort===v?`linear-gradient(135deg,${theme.p},${theme.s})`:'rgba(255,255,255,.06)', color:sort===v?'#000':'rgba(255,255,255,.4)', textAlign:'left' }}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <p style={{ fontSize:9, fontWeight:800, opacity:.3, textTransform:'uppercase', letterSpacing:'.1em', marginBottom:8 }}>Genres</p>
              <div className="ns" style={{ display:'flex', flexDirection:'column', gap:3, maxHeight:300, overflowY:'auto' }}>
                <button onClick={() => { setFilters(p => ({ ...p, genre:'' })); setView('browse'); }} style={{ padding:'7px 10px', borderRadius:9, border:`1px solid ${!filters.genre?theme.p+'44':'transparent'}`, background:!filters.genre?`${theme.p}18`:'rgba(255,255,255,.04)', color:!filters.genre?theme.p:'rgba(255,255,255,.38)', cursor:'pointer', fontSize:11, fontWeight:700, fontFamily:'inherit', textAlign:'left' }}>🎬 {t('all',lang)}</button>
                {GENRES.map(g => (
                  <button key={g.id} onClick={() => { setFilters(p => ({ ...p, genre:g.id })); setView('browse'); setPage(1); }} style={{ padding:'7px 10px', borderRadius:9, border:`1px solid ${filters.genre===g.id?theme.p+'44':'transparent'}`, background:filters.genre===g.id?`${theme.p}18`:'rgba(255,255,255,.04)', color:filters.genre===g.id?theme.p:'rgba(255,255,255,.38)', cursor:'pointer', fontSize:11, fontWeight:700, fontFamily:'inherit', textAlign:'left', display:'flex', alignItems:'center', gap:6 }}>
                    <span>{g.e}</span><span>{g[lang]||g.en}</span>
                  </button>
                ))}
              </div>
            </div>
            {isAuth && (
              <div style={{ padding:11, borderRadius:13, background:`${theme.p}0d`, border:`1px solid ${theme.p}22` }}>
                <p style={{ fontSize:9, fontWeight:800, opacity:.35, textTransform:'uppercase', letterSpacing:'.1em', marginBottom:7 }}>My Progress</p>
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}><span style={{ fontSize:11, opacity:.45 }}>{t('level',lang)}</span><span className="syne" style={{ fontSize:14, fontWeight:800, color:theme.p }}>{stats.level}</span></div>
                  <Bar value={stats.xpInLvl} max={100} grad={`linear-gradient(90deg,${theme.p},${theme.s})`} h={4}/>
                  {[[t('watched',lang),stats.watched],[t('favs',lang),favs.length],['Rated',stats.rated]].map(([l,v]) => (
                    <div key={l} style={{ display:'flex', justifyContent:'space-between' }}>
                      <span style={{ fontSize:10, opacity:.35 }}>{l}</span>
                      <span className="syne" style={{ fontSize:11, fontWeight:800 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Main content */}
        <main style={{ flex:1, minWidth:0 }}>

          {/* HOME */}
          {curView === 'home' && (
            <div className="fu">
              {topRated[0] && (
                <div onClick={() => openMovie(topRated[0])} style={{ borderRadius:24, overflow:'hidden', position:'relative', height:320, cursor:'pointer', marginBottom:28, boxShadow:`0 20px 60px rgba(0,0,0,.7),0 0 0 1px ${theme.p}22` }}
                  onMouseEnter={e => { e.currentTarget.querySelector('.hero-img').style.transform='scale(1.05)'; }}
                  onMouseLeave={e => { e.currentTarget.querySelector('.hero-img').style.transform='scale(1)'; }}>
                  <img className="hero-img" src={topRated[0].background_image || topRated[0].large_cover_image} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', objectPosition:'top', transition:'transform .6s ease', display:'block' }}/>
                  <div style={{ position:'absolute', inset:0, background:`linear-gradient(to right, rgba(0,0,0,.9) 0%, rgba(0,0,0,.5) 50%, transparent 100%), linear-gradient(to top, rgba(0,0,0,.8) 0%, transparent 60%)` }}/>
                  <div style={{ position:'absolute', inset:0, padding:'28px 32px', display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
                    <div style={{ display:'flex', gap:8, marginBottom:10, flexWrap:'wrap' }}>
                      {topRated[0].rating > 0 && <IMDbScore n={topRated[0].rating}/>}
                      {topRated[0].year && <span style={{ fontSize:11, padding:'2px 8px', borderRadius:7, background:'rgba(255,255,255,.12)', color:'rgba(255,255,255,.7)', fontWeight:700 }}>{topRated[0].year}</span>}
                      {topRated[0].genres?.slice(0,2).map(g => <span key={g} style={{ fontSize:11, padding:'2px 8px', borderRadius:7, background:`${theme.p}33`, color:theme.p, fontWeight:700 }}>{g}</span>)}
                    </div>
                    <h2 className="syne" style={{ fontSize:28, fontWeight:800, color:'white', marginBottom:8, lineHeight:1.2, maxWidth:500 }}>{topRated[0].title}</h2>
                    <p style={{ fontSize:12, color:'rgba(255,255,255,.55)', lineHeight:1.6, maxWidth:420, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{topRated[0].summary}</p>
                    <div style={{ display:'flex', gap:10, marginTop:14 }}>
                      <button className="btn-p" style={{ padding:'11px 22px', borderRadius:12, fontSize:13, display:'flex', alignItems:'center', gap:8, boxShadow:`0 8px 24px ${theme.p}55` }}>
                        ▶ {t('watch',lang)}
                      </button>
                      <button onClick={e => { e.stopPropagation(); handleFav(topRated[0]); }} style={{ padding:'11px 18px', borderRadius:12, fontSize:13, background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.2)', color:'white', cursor:'pointer', fontFamily:'inherit', fontWeight:700, backdropFilter:'blur(8px)' }}>
                        {favIds.has(topRated[0].id) ? '♥' : '♡'} {t('favs',lang)}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {!homeLoaded ? (
                Array(3).fill(0).map((_,ri) => (
                  <div key={ri} style={{ marginBottom:28 }}>
                    <div style={{ height:20, width:160, borderRadius:8, background:'rgba(255,255,255,.07)', marginBottom:12, position:'relative', overflow:'hidden' }}><div className="shimmer" style={{ position:'absolute', inset:0 }}/></div>
                    <div style={{ display:'flex', gap:10 }}>
                      {Array(6).fill(0).map((_,i) => <div key={i} style={{ flexShrink:0, width:148 }}><SkeletonCard/></div>)}
                    </div>
                  </div>
                ))
              ) : (
                <>
                  <CategoryRow title={t('popular',lang)} movies={popular} onOpen={openMovie} onFav={handleFav} favIds={favIds} lib={library} ratings={ratings} themeP={theme.p} icon="🔥" lang={lang}/>
                  <CategoryRow title={t('topRated',lang)} movies={topRated} onOpen={openMovie} onFav={handleFav} favIds={favIds} lib={library} ratings={ratings} themeP={theme.p} icon="⭐" lang={lang}/>
                  <CategoryRow title={t('latest',lang)} movies={latest} onOpen={openMovie} onFav={handleFav} favIds={favIds} lib={library} ratings={ratings} themeP={theme.p} icon="🆕" lang={lang}/>
                </>
              )}

              <section>
                <h2 className="syne" style={{ fontSize:18, fontWeight:700, marginBottom:14 }}>🎭 Genres</h2>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:8 }}>
                  {GENRES.slice(0,12).map(g => (
                    <button key={g.id} onClick={() => { setFilters(p => ({ ...p, genre:g.id })); setView('browse'); setPage(1); }} style={{ padding:'14px 10px', borderRadius:14, border:'1px solid rgba(255,255,255,.08)', background:'rgba(255,255,255,.04)', cursor:'pointer', textAlign:'center', fontFamily:'inherit', transition:'all .22s', position:'relative', overflow:'hidden' }}
                      onMouseEnter={e => { e.currentTarget.style.background=`${theme.p}18`; e.currentTarget.style.borderColor=`${theme.p}44`; e.currentTarget.style.transform='translateY(-3px)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,.04)'; e.currentTarget.style.borderColor='rgba(255,255,255,.08)'; e.currentTarget.style.transform=''; }}>
                      <div style={{ fontSize:24, marginBottom:5 }}>{g.e}</div>
                      <p style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,.7)' }}>{g[lang]||g.en}</p>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* BROWSE */}
          {curView === 'browse' && (
            <div className="fu">
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:8 }}>
                <div>
                  <h1 className="syne" style={{ fontSize:20, fontWeight:800, marginBottom:2 }}>{t('browse',lang)}</h1>
                  <p style={{ fontSize:11, color:'rgba(255,255,255,.3)' }}>
                    {browseTotal > 0 && <span style={{ color:theme.p, fontWeight:700 }}>{browseTotal.toLocaleString()} </span>}
                    {t('films',lang)}
                    {hasFilters && <span style={{ color:'#f59e0b', marginLeft:8 }}>· Filtered</span>}
                  </p>
                </div>
                <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
                  <div style={{ display:'flex', borderRadius:10, overflow:'hidden', border:'1px solid rgba(255,255,255,.1)' }}>
                    {[['grid','⊞'],['list','☰']].map(([m,i]) => (
                      <button key={m} onClick={() => setVMode(m)} style={{ width:34, height:32, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:13, fontWeight:800, transition:'all .2s', background:vMode===m?`linear-gradient(135deg,${theme.p},${theme.s})`:'rgba(255,255,255,.07)', color:vMode===m?'#000':'rgba(255,255,255,.38)' }}>{i}</button>
                    ))}
                  </div>
                  {hasFilters && <button onClick={() => { setFilters({ genre:'', year:null, ratingMin:0, quality:'' }); setPage(1); }} style={{ padding:'5px 12px', borderRadius:10, border:'1px solid rgba(245,158,11,.35)', background:'rgba(245,158,11,.08)', color:'#f59e0b', cursor:'pointer', fontSize:11, fontWeight:700, fontFamily:'inherit' }}>✕ {t('reset',lang)}</button>}
                </div>
              </div>

              {loadBr ? (
                <div className="card-grid">{Array(PER_PAGE).fill(0).map((_,i) => <SkeletonCard key={i}/>)}</div>
              ) : browse.length === 0 ? (
                <div style={{ textAlign:'center', padding:'64px 20px' }}>
                  <span style={{ fontSize:52, display:'block', marginBottom:14 }}>📭</span>
                  <p style={{ fontSize:16, fontWeight:700, opacity:.35 }}>{t('notFound',lang)}</p>
                </div>
              ) : vMode === 'grid' ? (
                <div className="card-grid stagger">
                  {browse.map((m,idx) => (
                    <div key={`${m.id}-${idx}`}>
                      <MovieCard movie={m} onClick={openMovie} onFav={handleFav} faved={favIds.has(m.id)} status={library[m.id]?.status} userRating={ratings[m.id]} themeP={theme.p} lang={lang}/>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {browse.map((m,idx) => (
                    <div key={`${m.id}-${idx}`} className="card" style={{ borderRadius:14, display:'flex', gap:12, padding:'11px 12px', cursor:'pointer', transition:'background .2s' }}
                      onClick={() => openMovie(m)}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.07)'}
                      onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,.04)'}>
                      <div style={{ width:52, flexShrink:0, borderRadius:9, overflow:'hidden', aspectRatio:'2/3', background:'#0a0a14', position:'relative' }}>
                        <LazyImg src={m.medium_cover_image} alt={m.title} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p className="lc1 syne" style={{ fontSize:14, fontWeight:700 }}>{m.title}</p>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:4 }}>
                          {m.rating > 0 && <IMDbScore n={m.rating}/>}
                          {m.year && <span style={{ fontSize:10, padding:'1px 7px', borderRadius:6, background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.4)', fontWeight:600 }}>{m.year}</span>}
                          {m.runtime > 0 && <span style={{ fontSize:10, padding:'1px 7px', borderRadius:6, background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.4)', fontWeight:600 }}>{m.runtime}m</span>}
                        </div>
                        {m.summary && <p className="lc2" style={{ fontSize:11, color:'rgba(255,255,255,.32)', lineHeight:1.55, marginTop:4 }}>{m.summary}</p>}
                      </div>
                      <button onClick={e => { e.stopPropagation(); handleFav(m); }} style={{ width:32, height:32, borderRadius:9, border:'none', cursor:'pointer', background:favIds.has(m.id)?'#f43f5e22':'rgba(255,255,255,.06)', color:favIds.has(m.id)?'#f43f5e':'rgba(255,255,255,.3)', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', alignSelf:'center', fontFamily:'inherit' }}>
                        {favIds.has(m.id)?'♥':'♡'}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {!loadBr && browse.length > 0 && (
                <Pagination page={page} setPage={setPage} hasMore={hasMore} loading={loadBr} themeP={theme.p} themeS={theme.s} lang={lang} total={browseTotal}/>
              )}
            </div>
          )}

          {/* LIBRARY / FAVS / WATCHLIST / HISTORY */}
          {['library','favs','watchlist','history'].includes(curView) && (
            <div className="fu">
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                <div>
                  <h1 className="syne" style={{ fontSize:20, fontWeight:800, marginBottom:2 }}>
                    {{ library:t('library',lang), favs:t('favs',lang), watchlist:t('watchlist',lang), history:t('history',lang) }[curView]}
                  </h1>
                  <p style={{ fontSize:11, color:'rgba(255,255,255,.3)' }}><span style={{ color:theme.p, fontWeight:700 }}>{displayData.length} </span>{t('films',lang)}</p>
                </div>
              </div>
              {!isAuth ? (
                <div style={{ textAlign:'center', padding:'64px 20px' }}>
                  <span style={{ fontSize:52, display:'block', marginBottom:14 }}>🔐</span>
                  <p style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>{t('signInToUse',lang)}</p>
                  <button onClick={() => setAuthOpen(true)} className="btn-p" style={{ padding:'11px 24px', borderRadius:12, fontSize:14 }}>{t('login',lang)}</button>
                </div>
              ) : displayData.length === 0 ? (
                <div style={{ textAlign:'center', padding:'64px 20px' }}>
                  <span style={{ fontSize:52, display:'block', marginBottom:14 }}>📭</span>
                  <p style={{ fontSize:15, fontWeight:700, opacity:.35 }}>{t('notFound',lang)}</p>
                </div>
              ) : (
                <div className="card-grid stagger">
                  {displayData.map((m,idx) => (
                    <div key={`${m.id}-${idx}`}>
                      <MovieCard movie={m} onClick={openMovie} onFav={handleFav} faved={favIds.has(m.id)} status={library[m.id]?.status} userRating={ratings[m.id]} themeP={theme.p} lang={lang}/>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STATS */}
          {curView === 'stats' && (
            !isAuth ? (
              <div style={{ textAlign:'center', padding:'64px 20px' }}>
                <span style={{ fontSize:52, display:'block', marginBottom:14 }}>📊</span>
                <p style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>{t('signInToUse',lang)}</p>
                <button onClick={() => setAuthOpen(true)} className="btn-p" style={{ padding:'11px 24px', borderRadius:12, fontSize:14 }}>{t('login',lang)}</button>
              </div>
            ) : (
              <StatsPage stats={stats} user={user} lib={library} ratings={ratings} favs={favs.length} achs={achs} themeP={theme.p} themeS={theme.s} lang={lang}/>
            )
          )}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="mob" style={{ position:'fixed', bottom:0, left:0, right:0, zIndex:600, background:`${theme.b}f5`, backdropFilter:'blur(24px) saturate(200%)', borderTop:'1px solid rgba(255,255,255,.08)', paddingBottom:'env(safe-area-inset-bottom,0)', justifyContent:'center' }}>
        <div style={{ display:'flex', alignItems:'center', width:'100%', maxWidth:460, padding:'6px 8px' }}>
          {[
            { k:'home', i:'🏠', l:t('home',lang) },
            { k:'browse', i:'🎬', l:t('browse',lang) },
            { k:'favs', i:'❤️', l:t('favs',lang) },
            { k:'library', i:'📚', l:t('library',lang) },
            { k:'stats', i:'📊', l:t('stats',lang) },
          ].map(v => (
            <button key={v.k} onClick={() => setView(v.k)} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3, padding:'6px 0', border:'none', borderRadius:13, cursor:'pointer', fontFamily:'inherit', background:curView===v.k?`${theme.p}1e`:'transparent', transition:'all .2s' }}>
              <span style={{ fontSize:18 }}>{v.i}</span>
              <span style={{ fontSize:9, fontWeight:700, color:curView===v.k?theme.p:'rgba(255,255,255,.26)' }}>{v.l}</span>
            </button>
          ))}
          {isAuth ? (
            <button onClick={() => setProfOpen(true)} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3, border:'none', background:'transparent', cursor:'pointer', padding:'5px 0', fontFamily:'inherit' }}>
              <img src={user.avatar} style={{ width:22, height:22, borderRadius:7, objectFit:'cover', border:`1.5px solid ${theme.p}` }}/>
              <span style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,.26)' }}>{t('profile',lang)}</span>
            </button>
          ) : (
            <button onClick={() => setAuthOpen(true)} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3, border:'none', background:`${theme.p}1e`, borderRadius:13, cursor:'pointer', padding:'6px 0', fontFamily:'inherit' }}>
              <span style={{ fontSize:18 }}>👤</span>
              <span style={{ fontSize:9, fontWeight:700, color:theme.p }}>{t('login',lang)}</span>
            </button>
          )}
        </div>
      </nav>

      <footer className="desk" style={{ borderTop:'1px solid rgba(255,255,255,.06)', padding:'24px 18px', flexDirection:'column', gap:4, marginTop:16, textAlign:'center', position:'relative', zIndex:2 }}>
        <p className="syne" style={{ fontSize:18, fontWeight:800, background:`linear-gradient(135deg,${theme.p},#fff)`, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>CineHub</p>
        <p style={{ fontSize:11, color:'rgba(255,255,255,.14)' }}>© 2026 · Built with ❤</p>
      </footer>
    </div>
  );
}