(function () {
  'use strict';

  var KEY = 'medtt.v1';
  /* 시험은 빨강을 독차지한다. 그래서 과목 팔레트에는 빨강을 넣지 않는다. */
  var PALETTE = ['#6f92b8', '#c4a765', '#94ab74', '#8e81b5',
                 '#d49a6f', '#74ada6', '#7cae8a'];
  var EXAM = '#c9736c';
  var OFF = '#a8b0b5';
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  var DB = null;
  var weekCur = null;

  var $ = function (id) { return document.getElementById(id); };
  var main = $('main'), hdr = $('hdr'), sheet = $('sheet'), scrim = $('scrim');

  /* ---------- 날짜 유틸 (문자열 기준, 타임존 영향 없음) ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toDate(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowHM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
  function dowOf(s) { return toDate(s).getUTCDay(); }
  function dow(s) { return DOW[dowOf(s)]; }
  function md(s) { var p = s.split('-'); return +p[1] + '/' + +p[2]; }
  function mins(hm) { return +hm.slice(0, 2) * 60 + +hm.slice(3); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 과정 색상 ----------
     과목명을 해시해 파스텔을 고른다. 엑셀을 다시 올려 과목 순서가 바뀌어도
     같은 과목은 같은 색을 유지한다. 두 과목이 같은 칸에 걸리면 빈 칸으로 밀어
     팔레트가 남아 있는 한 색이 겹치지 않게 한다. */
  var _cmap = null;
  function hash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  function courseColors() {
    if (_cmap) return _cmap;
    var used = {}, map = {};
    DB.courses.forEach(function (c, n) {
      var i = hash(c) % PALETTE.length;
      if (n < PALETTE.length) while (used[i]) i = (i + 1) % PALETTE.length;
      used[i] = 1; map[c] = PALETTE[i];
    });
    _cmap = map;
    return map;
  }
  function colorOf(cid) {
    return cid ? courseColors()[cid] || OFF : OFF;   // 휴일·자율학습은 과목이 없다
  }

  /* ---------- 저장 ---------- */
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }

  /* 표시 설정: 블록이 좁아 정보를 다 못 넣으므로 무엇을 보일지 고르게 한다 */
  var PREF = { fs: 'm', prof: true };
  try { Object.assign(PREF, JSON.parse(localStorage.getItem('medtt.pref') || '{}')); } catch (e) {}
  function savePref() {
    try { localStorage.setItem('medtt.pref', JSON.stringify(PREF)); } catch (e) {}
    document.body.dataset.fs = PREF.fs;
  }
  document.body.dataset.fs = PREF.fs;

  /* ---------- 시트 ---------- */
  function openSheet(html) {
    $('sheetBody').innerHTML = html;
    sheet.classList.add('on'); scrim.classList.add('on');
  }
  function closeSheet() { sheet.classList.remove('on'); scrim.classList.remove('on'); }
  scrim.addEventListener('click', closeSheet);

  /* ---------- 파생 데이터 ---------- */
  var real = function (e) { return e.kind !== '휴일'; };

  function nextExam() {
    var t = today();
    return DB.events.filter(function (e) { return e.isExam && e.date >= t; })[0] || null;
  }
  function weekNos() { return Object.keys(DB.weeks).map(Number).sort(function (a, b) { return a - b; }); }
  function weekOf(date) {
    var ns = weekNos();
    for (var i = 0; i < ns.length; i++) {
      var ds = DB.weeks[ns[i]];
      if (date >= ds[0] && date <= ds[ds.length - 1]) return ns[i];
    }
    for (var j = 0; j < ns.length; j++) if (DB.weeks[ns[j]][0] > date) return ns[j];
    return ns[ns.length - 1];
  }

  /* 학기 내내 한 번도 안 쓰는 요일/교시는 접는다.
     이 시간표는 토요일 0회, 9교시 0회라 6x9 그리드의 46%만 차 있었다. */
  var _live = null;
  function live() {
    if (_live) return _live;
    var days = {}, periods = {};
    DB.events.forEach(function (e) {
      if (!real(e)) return;
      days[dowOf(e.date)] = 1;
      for (var p = e.periods[0]; p <= e.periods[1]; p++) periods[p] = 1;
    });
    _live = {
      days: days,
      periods: DB.periods.filter(function (p) { return periods[p.no]; })
    };
    return _live;
  }
  function weekExams(w) {
    var ds = DB.weeks[w];
    return DB.events.filter(function (e) { return e.isExam && ds.indexOf(e.date) >= 0; });
  }

  /* 그 주 수업이 걸친 시간대를 정시 단위로 스냅한다.
     교시 칸 대신 시계 눈금을 쓰므로 공강과 연강 길이가 그대로 보인다. */
  var PPM = 1;
  function weekRange(cols) {
    var lo = 1e9, hi = -1;
    DB.events.forEach(function (e) {
      if (cols.indexOf(e.date) < 0) return;
      lo = Math.min(lo, mins(e.start)); hi = Math.max(hi, mins(e.end));
    });
    if (hi < 0) { lo = 9 * 60; hi = 17 * 60; }
    return { lo: Math.floor(lo / 60) * 60, hi: Math.ceil(hi / 60) * 60 };
  }

  /* ---------- 렌더 ---------- */
  function render() {
    if (!DB) return renderUpload();
    hdr.hidden = false;

    $('hTitle').textContent = DB.title;
    $('hSub').textContent = weekCur + '주차';

    var html = '';
    var ex = nextExam();
    if (ex) {
      var n = diffDays(today(), ex.date);
      html += '<button class="dday" id="ddayBtn">'
        + '<span class="n">' + (n === 0 ? 'D-DAY' : 'D-' + n) + '</span>'
        + '<span class="t"><b>' + esc(ex.title) + '</b>'
        + '<span>' + esc(ex.courseId) + ' · ' + md(ex.date) + '(' + dow(ex.date) + ') ' + ex.start + '</span></span>'
        + '<span class="chev">&rsaquo;</span></button>';
    }
    html += viewWeek();
    main.innerHTML = html;

    if ($('ddayBtn')) $('ddayBtn').onclick = showExams;
    wire();
  }

  /* ---------- 주간 ---------- */
  function viewWeek() {
    var ns = weekNos(), t = today(), now = nowHM();
    var all = DB.weeks[weekCur];
    var L = live();
    var cols = all.filter(function (d) { return L.days[dowOf(d)]; });

    // 학기 전체를 한 줄로: 시험 있는 주는 점으로 표시. 시간표 아래에 놓는다.
    var strip = '<div class="strip" id="strip">';
    ns.forEach(function (w) {
      var ex = weekExams(w).length;
      var has = DB.events.some(function (e) { return real(e) && DB.weeks[w].indexOf(e.date) >= 0; });
      strip += '<button class="wk' + (w === weekCur ? ' on' : '') + (has ? '' : ' off') + '" data-week="' + w + '">'
        + w + (ex ? '<i></i>' : '') + '</button>';
    });
    strip += '</div>';

    var h = '<div class="wknav">'
      + '<button class="arw" data-wk="-1"' + (ns.indexOf(weekCur) <= 0 ? ' disabled' : '') + '>&lsaquo;</button>'
      + '<b>' + weekCur + '주차 · ' + md(cols[0]) + ' ~ ' + md(cols[cols.length - 1]) + '</b>'
      + '<button class="arw" data-wk="1"' + (ns.indexOf(weekCur) >= ns.length - 1 ? ' disabled' : '') + '>&rsaquo;</button></div>';

    // 시계 눈금 기준 배치. 블록 높이가 실제 수업 길이에 비례한다.
    var R = weekRange(cols), H = (R.hi - R.lo) * PPM;

    h += '<div class="ttwrap"><div class="tthead"><span></span>';
    cols.forEach(function (d) {
      h += '<b class="' + (d === t ? 'td' : '') + '">' + dow(d) + '</b>';
    });
    h += '</div><div class="tt" style="height:' + H + 'px">';

    // 시간축은 12시간제. 오후 1시를 13이라 쓰지 않는다.
    h += '<div class="axis">';
    for (var m = R.lo; m < R.hi; m += 60) {
      var hh = m / 60;
      h += '<u style="top:' + ((m - R.lo) * PPM) + 'px">' + (hh > 12 ? hh - 12 : hh) + '</u>';
    }
    h += '</div><div class="body">';

    for (var m2 = R.lo; m2 <= R.hi; m2 += 60) {
      h += '<hr style="top:' + ((m2 - R.lo) * PPM) + 'px">';
    }

    cols.forEach(function (d) {
      h += '<div class="col' + (d === t ? ' td' : '') + '">';
      DB.events.forEach(function (e, idx) {
        if (e.date !== d) return;
        var top = (mins(e.start) - R.lo) * PPM;
        var hgt = (mins(e.end) - mins(e.start)) * PPM;
        var c = e.isExam ? EXAM : colorOf(e.courseId);
        var isNow = d === t && e.start <= now && now < e.end;
        h += '<button class="ev' + (isNow ? ' now' : '') + '" data-ev="' + idx + '"'
          + ' style="top:' + top + 'px;height:' + (hgt - 1) + 'px;'
          + '--c:' + c + ';background:' + c + ';color:#fff">'
          + (e.kind !== '강의' ? '<i class="k">' + esc(e.kind) + '</i>' : '')
          + '<b>' + esc(e.title) + '</b>'
          + (PREF.prof && e.prof && hgt > 46 ? '<i>' + esc(e.prof) + '</i>' : '')
          + '</button>';
      });
      h += '</div>';
    });

    var nm = mins(now);
    if (cols.indexOf(t) >= 0 && nm >= R.lo && nm <= R.hi) {
      h += '<div class="nowline" style="top:' + ((nm - R.lo) * PPM) + 'px"></div>';
    }

    return h + '</div></div></div>' + strip;
  }

  /* ---------- 이벤트 연결 ---------- */
  function gotoWeek(delta) {
    var ns = weekNos(), i = ns.indexOf(weekCur) + delta;
    if (i >= 0 && i < ns.length) { weekCur = ns[i]; render(); }
  }

  function wire() {
    var q = function (sel, fn) { Array.prototype.forEach.call(main.querySelectorAll(sel), fn); };
    q('[data-wk]', function (b) { b.onclick = function () { gotoWeek(+b.dataset.wk); }; });
    q('[data-week]', function (b) { b.onclick = function () { weekCur = +b.dataset.week; render(); }; });
    q('[data-ev]', function (b) {
      b.onclick = function () { showDetail(DB.events[+b.dataset.ev]); };
    });
    var on = main.querySelector('.strip .wk.on');
    if (on) on.parentNode.scrollLeft = on.offsetLeft - on.parentNode.clientWidth / 2 + on.clientWidth / 2;
  }

  /* 좌우 스와이프로 날짜/주 이동 */
  var sx = 0, sy = 0, tracking = false;
  main.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
  }, { passive: true });
  main.addEventListener('touchend', function (e) {
    if (!tracking || !DB) return;
    tracking = false;
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 55 || Math.abs(dy) > 45) return;
    var dir = dx < 0 ? 1 : -1;
    gotoWeek(dir);
  }, { passive: true });

  /* ---------- 시트 화면 ---------- */
  function showDetail(e) {
    var n = diffDays(today(), e.date);
    openSheet('<h3>' + esc(e.title) + '</h3>'
      + '<div class="sub">' + esc(e.courseId || '') + ' · ' + e.kind + '</div>'
      + '<div class="kv"><span>일시</span><b>' + e.date + ' (' + dow(e.date) + ') ' + e.start + '~' + e.end + '</b></div>'
      + '<div class="kv"><span>교시</span><b>' + e.periods[0] + (e.periods[1] !== e.periods[0] ? '~' + e.periods[1] : '') + '교시 · ' + e.week + '주차</b></div>'
      + (e.prof ? '<div class="kv"><span>교수</span><b>' + esc(e.prof) + '</b></div>' : '')
      + (e.isExam ? '<div class="kv"><span>남은날</span><b>' + (n < 0 ? '지남' : n === 0 ? '오늘' : 'D-' + n) + '</b></div>' : '')
      + '<div class="kv"><span>원본</span><b style="font-weight:400;color:var(--muted)">' + esc(e.raw) + '</b></div>');
  }

  function showExams() {
    var t = today();
    var h = '<h3>시험 일정</h3><div class="sub">전체 ' + DB.stats.exams + '개</div>';
    DB.events.filter(function (e) { return e.isExam; }).forEach(function (e) {
      var n = diffDays(t, e.date);
      h += '<button class="exrow' + (n < 0 ? ' past' : '') + '" data-jump="' + e.date + '">'
        + '<span class="d">' + (n < 0 ? '지남' : n === 0 ? '오늘' : 'D-' + n) + '</span>'
        + '<span class="i"><b>' + esc(e.title) + '</b>'
        + '<span>' + esc(e.courseId) + ' · ' + md(e.date) + '(' + dow(e.date) + ') ' + e.start + '~' + e.end + '</span></span>'
        + '</button>';
    });
    openSheet(h);
    Array.prototype.forEach.call(sheet.querySelectorAll('[data-jump]'), function (b) {
      b.onclick = function () { weekCur = weekOf(b.dataset.jump); closeSheet(); render(); };
    });
  }

  function showSettings() {
    openSheet('<h3>설정</h3><div class="sub">' + esc(DB ? DB.title : '') + '</div>'
      + (DB ? '<div class="kv"><span>일정</span><b>' + DB.stats.events + '개 · ' + DB.stats.weeks + '주 · 시험 ' + DB.stats.exams + '개</b></div>' : '')
      + '<div class="opt"><span>글자 크기</span><div class="seg" id="segFs">'
      + ['s', 'm', 'l'].map(function (v, i) {
          return '<button data-fs="' + v + '"' + (PREF.fs === v ? ' class="on"' : '') + '>' + ['작게', '보통', '크게'][i] + '</button>';
        }).join('') + '</div></div>'
      + '<div class="opt"><span>주간표에 교수명</span><div class="seg" id="segProf">'
      + '<button data-prof="0"' + (PREF.prof ? '' : ' class="on"') + '>숨김</button>'
      + '<button data-prof="1"' + (PREF.prof ? ' class="on"' : '') + '>표시</button></div></div>'
      + '<button class="btn" id="sReplace">엑셀 다시 올리기</button>'
      + '<button class="btn ghost" id="sReset">시간표 삭제</button>'
      + '<div class="note"><b>홈 화면에 추가</b><br>'
      + 'iPhone: Safari 하단 공유 버튼 → 홈 화면에 추가<br>'
      + 'Android: Chrome 우측 상단 ⋮ → 홈 화면에 추가</div>');

    Array.prototype.forEach.call(sheet.querySelectorAll('[data-fs]'), function (b) {
      b.onclick = function () { PREF.fs = b.dataset.fs; savePref(); showSettings(); render(); };
    });
    Array.prototype.forEach.call(sheet.querySelectorAll('[data-prof]'), function (b) {
      b.onclick = function () { PREF.prof = b.dataset.prof === '1'; savePref(); showSettings(); render(); };
    });
    $('sReplace').onclick = function () { closeSheet(); $('file').click(); };
    $('sReset').onclick = function () {
      localStorage.removeItem(KEY); DB = null; _live = null; _cmap = null; closeSheet(); hdr.hidden = true; renderUpload();
    };
  }

  function renderUpload(err) {
    hdr.hidden = true;
    main.innerHTML = '<div class="hero">'
      + '<img src="icons/icon-192.png" alt="">'
      + '<h1>의대 시간표</h1>'
      + '<p>학교에서 받은 시간표 엑셀을 올리면 주간 시간표와 시험 D-day를 만들어 줍니다.</p>'
      + '</div>'
      + '<button class="btn" id="pick">엑셀 파일 선택</button>'
      + (err ? '<div class="err">' + esc(err) + '</div>' : '')
      + '<div class="note"><b>파일이 안 보이면</b><br>'
      + '카카오톡에서 받은 파일은 먼저 <b>파일 앱에 저장</b>해야 선택기에 나옵니다. '
      + '카톡에서 파일 열기 → 공유 → &ldquo;파일에 저장&rdquo;.<br><br>'
      + '<b>올린 파일은 기기 밖으로 나가지 않습니다.</b> 서버 없이 브라우저 안에서만 처리합니다.</div>';
    $('pick').onclick = function () { $('file').click(); };
  }

  /* ---------- 파일 처리 ---------- */
  $('file').onchange = function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var wb = XLSX.read(new Uint8Array(fr.result), { type: 'array', cellDates: false });
        var best = null;
        wb.SheetNames.forEach(function (nm) {
          try {
            var r = TimetableParser.parseTimetable(wb.Sheets[nm], XLSX);
            if (!best || r.events.length > best.events.length) best = r;
          } catch (e2) {}
        });
        if (!best || !best.events.length) throw new Error('시간표 형식을 인식하지 못했습니다.');
        DB = best; _live = null; _cmap = null; save(DB);
        weekCur = weekOf(today());
        render();
      } catch (e3) {
        renderUpload(e3.message || '파일을 읽지 못했습니다.');
      }
      ev.target.value = '';
    };
    fr.onerror = function () { renderUpload('파일을 읽지 못했습니다.'); };
    fr.readAsArrayBuffer(f);
  };

  /* ---------- 부팅 ---------- */
  $('gear').onclick = showSettings;
  document.addEventListener('visibilitychange', function () { if (!document.hidden && DB) render(); });

  function boot(d) {
    DB = d; _live = null; _cmap = null;
    if (!DB) return renderUpload();
    weekCur = weekOf(today());
    render();
  }

  var stored = load();
  if (stored) boot(stored);
  else {
    fetch('preset.json').then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) save(d); boot(d); })
      .catch(function () { boot(null); });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
