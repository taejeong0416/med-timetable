(function () {
  'use strict';

  var KEY = 'medtt.v1';
  /* 시험은 빨강을 독차지한다. 그래서 과목 팔레트에는 빨강을 넣지 않는다. */
  var PALETTE = ['#6f92b8', '#c4a765', '#94ab74', '#8e81b5',
                 '#d49a6f', '#74ada6', '#7cae8a'];
  var EXAM = '#c9736c';
  var OFF = '#a8b0b5';
  /* 유형별 색: 시험류는 EXAM, 그 밖에 표에 없는 유형은 금색으로 떨어진다 */
  var KINDC = { '강의': '#6f92b8', '실습': '#94ab74', 'PBL': '#8e81b5', '휴일': OFF };
  var KINDETC = '#c4a765';
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
  /* 어느 규칙이든 시험은 빨강을 독차지한다 */
  function blockColor(e) {
    if (e.isExam) return EXAM;
    if (PREF.cmode === 'kind') return KINDC[e.kind] || KINDETC;
    return colorOf(e.courseId);
  }

  /* ---------- 저장 ---------- */
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }

  /* 표시 설정: 블록이 좁아 정보를 다 못 넣으므로 무엇을 보일지 고르게 한다 */
  var PREF = { fs: 'm', prof: true, cmode: 'course' };
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

  /* 1분당 px. 정시 60px이 기준이되, 화면이 짧으면 한 주가 다 들어가게 줄인다.
     0.62 아래로는 블록에 과목명 한 줄도 안 들어가 더 줄이지 않는다. */
  var CHROME = 230;   // 헤더 + 주차 줄 + 요일 줄 + 주차 스트립 + 위아래 여백
  function ppm(R) {
    var avail = window.innerHeight - CHROME;
    return Math.max(0.62, Math.min(1, avail / (R.hi - R.lo)));
  }
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

    // 시험 D-day는 카드 대신 주차 옆 칩으로. 첫 화면에서 시간표가 잘리지 않는다.
    var ex = nextExam(), chip = '';
    if (ex) {
      var n = diffDays(today(), ex.date);
      chip = '<button class="ddchip" id="ddayBtn">'
        + '<b>' + (n === 0 ? 'D-DAY' : 'D-' + n) + '</b>'
        + '<span>' + esc(ex.title) + '</span></button>';
    }
    $('hSub').innerHTML = weekCur + '주차' + chip;
    if ($('ddayBtn')) $('ddayBtn').onclick = function () { showExams(false); };

    main.innerHTML = viewWeek();
    wire();

    // 2) 주 이동 방향으로 밀려 들어온다. 한 번 쓰고 지운다.
    if (slide) {
      var w = main.querySelector('.ttwrap');
      if (w) w.classList.add('in-' + slide);
      slide = null;
    }
  }

  /* ---------- 주간 ---------- */
  function viewWeek() {
    var ns = weekNos(), cols = weekCols(weekCur);

    // 학기 전체를 한 줄로: 시험 있는 주는 점으로, 지난 주는 흐리게
    var t = today();
    var h = '<div class="strip" id="strip">';
    ns.forEach(function (w) {
      var ds = DB.weeks[w], ex = weekExams(w).length;
      var has = DB.events.some(function (e) { return real(e) && ds.indexOf(e.date) >= 0; });
      var gone = ds[ds.length - 1] < t;
      h += '<button class="wk' + (w === weekCur ? ' on' : '') + (has ? '' : ' off')
        + (gone ? ' past' : '') + '" data-week="' + w + '">'
        + w + (ex ? '<i></i>' : '') + '</button>';
    });
    h += '</div>';

    h += '<div class="wknav">'
      + '<button class="arw" data-wk="-1"' + (ns.indexOf(weekCur) <= 0 ? ' disabled' : '') + '>&lsaquo;</button>'
      + '<b>' + weekCur + '주차 · ' + md(cols[0]) + ' ~ ' + md(cols[cols.length - 1]) + '</b>'
      + '<button class="arw" data-wk="1"' + (ns.indexOf(weekCur) >= ns.length - 1 ? ' disabled' : '') + '>&rsaquo;</button></div>';

    // 손가락에 끌려 움직일 수 있게 표를 뷰포트 안 트랙에 담는다
    return h + '<div class="ttview" id="ttview"><div class="tttrack" id="tttrack">'
      + weekGrid(weekCur) + '</div></div>';
  }

  function weekCols(w) {
    var L = live();
    return DB.weeks[w].filter(function (d) { return L.days[dowOf(d)]; });
  }

  /* 한 주치 표 한 장. 드래그할 때 앞뒤 주를 같은 함수로 더 만들어 붙인다. */
  function weekGrid(wk) {
    var t = today(), now = nowHM(), cols = weekCols(wk);

    // 시계 눈금 기준 배치. 블록 높이가 실제 수업 길이에 비례한다.
    var R = weekRange(cols), pm = ppm(R), H = (R.hi - R.lo) * pm;

    var h = '<div class="ttwrap"><div class="tthead"><span></span>';
    cols.forEach(function (d) {
      h += '<b class="' + (d === t ? 'td' : '') + '">' + dow(d) + '</b>';
    });
    h += '</div><div class="tt" style="height:' + H + 'px">';

    // 시간축은 12시간제. 오후 1시를 13이라 쓰지 않는다.
    // 정시마다 눈금을 긋는다. 수업 블록이 안쪽 격자선을 덮어도 여기로 경계를 읽는다.
    h += '<div class="axis">';
    for (var m = R.lo; m <= R.hi; m += 60) {
      var hh = m / 60;
      h += '<s style="top:' + ((m - R.lo) * pm) + 'px"></s>'
        + (m < R.hi ? '<u style="top:' + ((m - R.lo) * pm) + 'px">' + (hh > 12 ? hh - 12 : hh) + '</u>' : '');
    }
    h += '</div><div class="body">';

    for (var m2 = R.lo; m2 <= R.hi; m2 += 60) {
      h += '<hr style="top:' + ((m2 - R.lo) * pm) + 'px">';
    }

    var nm = mins(now);

    cols.forEach(function (d) {
      h += '<div class="col' + (d === t ? ' td' : '') + '">';
      DB.events.forEach(function (e, idx) {
        if (e.date !== d) return;
        var top = (mins(e.start) - R.lo) * pm;
        var hgt = (mins(e.end) - mins(e.start)) * pm;
        var c = blockColor(e);
        var isNow = d === t && e.start <= now && now < e.end;
        h += '<button class="ev' + (isNow ? ' now' : '') + '" data-ev="' + idx + '"'
          + ' style="top:' + top + 'px;height:' + (hgt - 1) + 'px;'
          + '--c:' + c + ';background:' + c + ';color:#fff">'
          // 제목에 이미 '실습'·'형성평가'가 들어 있으면 유형 줄을 또 쓰지 않는다
          + (e.kind !== '강의' && e.title.indexOf(e.kind) < 0
              ? '<i class="k">' + esc(e.kind) + '</i>' : '')
          + '<b>' + esc(e.title) + '</b>'
          + (PREF.prof && e.prof && hgt > 70 ? '<i>' + esc(e.prof) + '</i>' : '')
          + '</button>';
      });

      // 지금 시각 선은 오늘 열에만 긋는다. 다른 요일까지 가로지를 이유가 없다.
      if (d === t && nm >= R.lo && nm <= R.hi) {
        h += '<div class="nowline" style="top:' + ((nm - R.lo) * pm) + 'px"></div>';
      }
      h += '</div>';
    });

    return h + '</div></div></div>';
  }

  /* ---------- 이벤트 연결 ---------- */
  var slide = null;
  function gotoWeek(delta) {
    var ns = weekNos(), i = ns.indexOf(weekCur) + delta;
    if (i < 0 || i >= ns.length) return;
    weekCur = ns[i]; slide = delta > 0 ? 'l' : 'r'; render();
  }

  function wire() {
    var q = function (sel, fn) { Array.prototype.forEach.call(main.querySelectorAll(sel), fn); };
    q('[data-wk]', function (b) { b.onclick = function () { gotoWeek(+b.dataset.wk); }; });
    q('[data-week]', function (b) {
      b.onclick = function () {
        var w = +b.dataset.week;
        slide = w > weekCur ? 'l' : w < weekCur ? 'r' : null;
        weekCur = w; render();
      };
    });
    q('[data-ev]', function (b) {
      b.onclick = function () { showDetail(DB.events[+b.dataset.ev]); };
    });
    var on = main.querySelector('.strip .wk.on');
    if (on) on.parentNode.scrollLeft = on.offsetLeft - on.parentNode.clientWidth / 2 + on.clientWidth / 2;
  }

  /* ---------- 끌어서 주 넘기기 ----------
     표가 손가락을 그대로 따라온다. 끌기 시작할 때 앞뒤 주를 양옆에 붙여
     한 줄로 만들고, 놓을 때 넘길지 제자리로 돌아올지 정한다. */
  var drag = null;

  function dragPrepare(d) {
    var ns = weekNos(), i = ns.indexOf(weekCur);
    d.prev = i > 0 ? ns[i - 1] : null;
    d.next = i < ns.length - 1 ? ns[i + 1] : null;

    var view = $('ttview');
    view.style.height = d.tr.offsetHeight + 'px';   // 앞뒤 주가 더 길어도 칸이 튀지 않는다
    d.w = view.clientWidth;

    d.tr.classList.add('dragging');                 // 끄는 동안은 전환 없이 손가락만 따라간다
    d.tr.insertAdjacentHTML('afterbegin', d.prev ? weekGrid(d.prev) : '<div class="ttwrap ghost"></div>');
    d.tr.insertAdjacentHTML('beforeend', d.next ? weekGrid(d.next) : '<div class="ttwrap ghost"></div>');
    d.tr.style.transform = 'translateX(-100%)';
  }

  main.addEventListener('touchstart', function (e) {
    if (!DB || e.touches.length !== 1 || drag) return;
    var tr = $('tttrack');
    if (!tr || !tr.contains(e.target)) return;
    drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, axis: '', tr: tr };
  }, { passive: true });

  main.addEventListener('touchmove', function (e) {
    if (!drag) return;
    var dx = e.touches[0].clientX - drag.x, dy = e.touches[0].clientY - drag.y;
    if (!drag.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) >= Math.abs(dx)) { drag = null; return; }   // 세로로 긋는 중이면 넘긴다
      drag.axis = 'x';
      dragPrepare(drag);
    }
    e.preventDefault();
    // 학기 양 끝에서는 끌리는 양을 줄여 더 없다는 걸 손으로 알린다
    if ((dx > 0 && drag.prev === null) || (dx < 0 && drag.next === null)) dx *= 0.28;
    drag.dx = dx;
    drag.tr.style.transform = 'translateX(calc(-100% + ' + dx + 'px))';
  }, { passive: false });

  main.addEventListener('touchend', function () {
    if (!drag) return;
    var d = drag; drag = null;
    if (d.axis !== 'x') return;

    var trip = Math.min(72, d.w * 0.22), go = 0;
    if (d.dx <= -trip && d.next !== null) go = 1;
    else if (d.dx >= trip && d.prev !== null) go = -1;

    d.tr.classList.remove('dragging');
    d.tr.style.transform = 'translateX(' + (-100 - go * 100) + '%)';

    var settled = false;
    var done = function () {
      if (settled) return;
      settled = true;
      d.tr.removeEventListener('transitionend', done);
      if (go) weekCur = go > 0 ? d.next : d.prev;
      slide = null;              // 끌어서 넘긴 건 밀려 들어오는 효과를 또 주지 않는다
      render();
    };
    d.tr.addEventListener('transitionend', done);
    setTimeout(done, 420);       // transitionend가 안 오는 경우 대비
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

  // 지난 시험은 접어 두고, 펼치면 최근에 끝난 것부터 보인다
  function showExams(showPast) {
    var t = today();
    var exams = DB.events.filter(function (e) { return e.isExam; });
    var up = exams.filter(function (e) { return e.date >= t; });
    var past = exams.filter(function (e) { return e.date < t; }).reverse();
    var row = function (e) {
      var n = diffDays(t, e.date);
      return '<button class="exrow' + (n < 0 ? ' past' : '') + '" data-jump="' + e.date + '">'
        + '<span class="d">' + (n < 0 ? '지남' : n === 0 ? '오늘' : 'D-' + n) + '</span>'
        + '<span class="i"><b>' + esc(e.title) + '</b>'
        + '<span>' + esc(e.courseId) + ' · ' + md(e.date) + '(' + dow(e.date) + ') ' + e.start + '~' + e.end + '</span></span>'
        + '</button>';
    };
    var h = '<h3>시험 일정</h3><div class="sub">남은 시험 ' + up.length + '개 · 전체 ' + exams.length + '개</div>'
      + (up.length ? up.map(row).join('') : '<div class="exnone">남은 시험이 없습니다</div>');
    if (past.length) {
      h += '<button class="expast" id="exPast">' + (showPast ? '완료된 시험 숨기기' : '완료된 시험 보기 ' + past.length) + '</button>';
      if (showPast) h += past.map(row).join('');
    }
    openSheet(h);
    Array.prototype.forEach.call(sheet.querySelectorAll('[data-jump]'), function (b) {
      b.onclick = function () { weekCur = weekOf(b.dataset.jump); closeSheet(); render(); };
    });
    if (past.length) $('exPast').onclick = function () { showExams(!showPast); };
  }

  /* ---------- 시험 일정 캘린더에 저장 ----------
     알림·위젯·잠금화면은 아이폰 캘린더가 훨씬 잘한다. 여기서는 .ics만 넘긴다.
     시험 유형을 여러 개 골라 한 파일로 내보낸다.
     시간대는 붙이지 않는다. 그러면 기기의 현지 시각 그대로 읽힌다. */
  function icsEsc(s) {
    return String(s == null ? '' : s).replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n');
  }

  /* 한 줄 75바이트 제한. 한글은 한 자가 3바이트라 글자 수로 세면 넘친다. */
  function icsFold(line) {
    var out = '', len = 0, b;
    for (var i = 0; i < line.length; i++) {
      b = line.charCodeAt(i) < 128 ? 1 : 3;
      if (len + b > 73) { out += '\r\n '; len = 1; }
      out += line[i]; len += b;
    }
    return out;
  }

  function icsTime(date, hm) { return date.replace(/-/g, '') + 'T' + hm.replace(':', '') + '00'; }

  function buildIcs(list, name) {
    var stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//medtt//KR', 'CALSCALE:GREGORIAN',
             'X-WR-CALNAME:' + icsEsc(name)];
    list.forEach(function (e) {
      var desc = [e.courseId, e.kind, e.prof].filter(Boolean).join(' · ');
      L.push('BEGIN:VEVENT',
        'UID:' + hash(e.date + e.start + e.title) + '@medtt',
        'DTSTAMP:' + stamp,
        'DTSTART:' + icsTime(e.date, e.start),
        'DTEND:' + icsTime(e.date, e.end),
        // 제목에 이미 유형이 들어 있으면 앞에 또 붙이지 않는다
        'SUMMARY:' + icsEsc((e.title.indexOf(e.kind) < 0 ? '[' + e.kind + '] ' : '') + e.title));
      if (desc) L.push('DESCRIPTION:' + icsEsc(desc));
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1D',
             'DESCRIPTION:' + icsEsc('내일 ' + e.title), 'END:VALARM',
             'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(icsFold).join('\r\n') + '\r\n';
  }

  /* 시험 유형을 나온 순서대로. [{kind, n}] */
  function examKinds() {
    var order = [], n = {};
    DB.events.forEach(function (e) {
      if (!e.isExam) return;
      if (!n[e.kind]) order.push(e.kind);
      n[e.kind] = (n[e.kind] || 0) + 1;
    });
    return order.map(function (k) { return { kind: k, n: n[k] }; });
  }

  function exportIcs(kinds) {
    var list = DB.events.filter(function (e) { return e.isExam && kinds.indexOf(e.kind) >= 0; });
    if (!list.length) return;
    var name = kinds.length === 1 ? kinds[0] : '시험';
    var blob = new Blob([buildIcs(list, DB.title + ' ' + name)],
                        { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = '시험_' + name + '.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function showSettings() {
    var ks = DB ? examKinds() : [];
    openSheet('<h3>설정</h3><div class="sub">' + esc(DB ? DB.title : '') + '</div>'
      + (DB ? '<div class="kv"><span>일정</span><b>' + DB.stats.events + '개 · ' + DB.stats.weeks + '주 · 시험 ' + DB.stats.exams + '개</b></div>' : '')
      + '<div class="opt"><span>글자 크기</span><div class="seg" id="segFs">'
      + ['s', 'm', 'l'].map(function (v, i) {
          return '<button data-fs="' + v + '"' + (PREF.fs === v ? ' class="on"' : '') + '>' + ['작게', '보통', '크게'][i] + '</button>';
        }).join('') + '</div></div>'
      + '<div class="opt"><span>블록 색</span><div class="seg" id="segC">'
      + '<button data-cmode="course"' + (PREF.cmode === 'kind' ? '' : ' class="on"') + '>과목별</button>'
      + '<button data-cmode="kind"' + (PREF.cmode === 'kind' ? ' class="on"' : '') + '>유형별</button></div></div>'
      + '<div class="opt"><span>주간표에 교수명</span><div class="seg" id="segProf">'
      + '<button data-prof="0"' + (PREF.prof ? '' : ' class="on"') + '>숨김</button>'
      + '<button data-prof="1"' + (PREF.prof ? ' class="on"' : '') + '>표시</button></div></div>'
      + (ks.length ? '<div class="icsw"><span>시험 일정 캘린더에 저장</span>'
          + ks.map(function (k) {
              return '<button data-ics="' + esc(k.kind) + '">' + esc(k.kind) + ' ' + k.n + '</button>';
            }).join('')
          + '<button class="save" id="icsSave"></button></div>' : '')
      + '<button class="btn" id="sReplace">엑셀 다시 올리기</button>'
      + '<button class="btn ghost" id="sReset">시간표 삭제</button>'
      + '<div class="note"><b>홈 화면에 추가</b><br>'
      + 'iPhone: Safari 하단 공유 버튼 → 홈 화면에 추가<br>'
      + 'Android: Chrome 우측 상단 ⋮ → 홈 화면에 추가</div>');

    Array.prototype.forEach.call(sheet.querySelectorAll('[data-fs]'), function (b) {
      b.onclick = function () { PREF.fs = b.dataset.fs; savePref(); showSettings(); render(); };
    });
    Array.prototype.forEach.call(sheet.querySelectorAll('[data-cmode]'), function (b) {
      b.onclick = function () { PREF.cmode = b.dataset.cmode; savePref(); showSettings(); render(); };
    });
    Array.prototype.forEach.call(sheet.querySelectorAll('[data-prof]'), function (b) {
      b.onclick = function () { PREF.prof = b.dataset.prof === '1'; savePref(); showSettings(); render(); };
    });
    if (ks.length) {
      var chips = Array.prototype.slice.call(sheet.querySelectorAll('[data-ics]'));
      var saveBtn = $('icsSave');
      var picked = function () {
        return chips.filter(function (b) { return b.classList.contains('on'); })
                    .map(function (b) { return b.dataset.ics; });
      };
      var sync = function () {
        var sel = picked();
        var n = sel.reduce(function (a, k) {
          return a + ks.filter(function (x) { return x.kind === k; })[0].n;
        }, 0);
        saveBtn.textContent = n ? n + '개 저장' : '유형을 고르세요';
        saveBtn.disabled = !n;
      };
      chips.forEach(function (b) {
        b.onclick = function () { b.classList.toggle('on'); sync(); };
      });
      saveBtn.onclick = function () { exportIcs(picked()); };
      sync();
    }
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
  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { if (DB) render(); }, 150);
  });

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
