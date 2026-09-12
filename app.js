(function () {
  'use strict';

  var KEY = 'medtt.v1';
  var HUES = [245, 176, 34, 340, 152, 282, 205, 14];
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  var DB = null;
  var tab = 'today';
  var dayCur = null;
  var weekCur = null;
  var dark = window.matchMedia('(prefers-color-scheme: dark)');

  var $ = function (id) { return document.getElementById(id); };
  var main = $('main'), hdr = $('hdr'), sheet = $('sheet'), scrim = $('scrim');

  /* ---------- 날짜 유틸 (문자열 기준, 타임존 영향 없음) ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toDate(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
  function shift(s, n) { var d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dow(s) { return DOW[toDate(s).getUTCDay()]; }
  function md(s) { var p = s.split('-'); return +p[1] + '/' + +p[2]; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 과정 색상 ---------- */
  function colorOf(cid) {
    var i = DB.courses.indexOf(cid);
    var h = HUES[(i < 0 ? DB.courses.length : i) % HUES.length];
    return dark.matches
      ? { bg: 'hsl(' + h + ' 30% 23%)', fg: 'hsl(' + h + ' 78% 85%)', bar: 'hsl(' + h + ' 62% 62%)' }
      : { bg: 'hsl(' + h + ' 72% 93%)', fg: 'hsl(' + h + ' 54% 29%)', bar: 'hsl(' + h + ' 56% 52%)' };
  }

  /* ---------- 저장 ---------- */
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }

  /* ---------- 시트 ---------- */
  function openSheet(html) {
    $('sheetBody').innerHTML = html;
    sheet.classList.add('on'); scrim.classList.add('on');
  }
  function closeSheet() { sheet.classList.remove('on'); scrim.classList.remove('on'); }
  scrim.addEventListener('click', closeSheet);

  /* ---------- 파생 데이터 ---------- */
  function classDays() {
    var set = {}, out = [];
    DB.events.forEach(function (e) { if (e.kind !== '휴일' && !set[e.date]) { set[e.date] = 1; out.push(e.date); } });
    return out.sort();
  }
  function nextExam() {
    var t = today();
    var list = DB.events.filter(function (e) { return e.isExam && e.date >= t; });
    return list.length ? list[0] : null;
  }
  function weekNos() {
    return Object.keys(DB.weeks).map(Number).sort(function (a, b) { return a - b; });
  }
  function weekOf(date) {
    var ns = weekNos();
    for (var i = 0; i < ns.length; i++) {
      var ds = DB.weeks[ns[i]];
      if (date >= ds[0] && date <= ds[ds.length - 1]) return ns[i];
    }
    for (var j = 0; j < ns.length; j++) if (DB.weeks[ns[j]][0] > date) return ns[j];
    return ns[ns.length - 1];
  }

  /* ---------- 렌더 ---------- */
  function render() {
    if (!DB) return renderUpload();
    hdr.hidden = false;

    var ex = nextExam();
    $('hTitle').textContent = DB.title;
    $('hSub').textContent = tab === 'today'
      ? dayCur + ' (' + dow(dayCur) + ')'
      : weekCur + '주차';
    $('tabToday').setAttribute('aria-selected', tab === 'today');
    $('tabWeek').setAttribute('aria-selected', tab === 'week');

    var html = '';
    if (ex) {
      var n = diffDays(today(), ex.date);
      html += '<button class="dday" id="ddayBtn">'
        + '<span class="n">' + (n === 0 ? 'D-DAY' : 'D-' + n) + '</span>'
        + '<span class="t"><b>' + esc(ex.title) + '</b>'
        + '<span>' + esc(ex.courseId) + ' · ' + md(ex.date) + '(' + dow(ex.date) + ') ' + ex.start + '</span></span>'
        + '<span class="chev">&rsaquo;</span></button>';
    }
    html += tab === 'today' ? viewToday() : viewWeek();
    main.innerHTML = html;

    if ($('ddayBtn')) $('ddayBtn').onclick = showExams;
    wire();
  }

  function viewToday() {
    var t = today();
    var evs = DB.events.filter(function (e) { return e.date === dayCur; });
    var h = '<div class="daynav">'
      + '<button class="arw" data-day="-1">&lsaquo;</button>'
      + '<b>' + md(dayCur) + ' (' + dow(dayCur) + ')' + (dayCur === t ? ' · 오늘' : '') + '</b>'
      + '<button class="arw" data-day="1">&rsaquo;</button></div>';

    if (!evs.length) {
      var nd = classDays().filter(function (d) { return d > dayCur; })[0];
      h += '<div class="empty">수업 없음'
        + (nd ? '<br><br><button class="btn ghost" data-goto="' + nd + '">다음 수업일 ' + md(nd) + '(' + dow(nd) + ') 보기</button>' : '')
        + '</div>';
      return h;
    }

    var nowHM = new Date().toTimeString().slice(0, 5);
    evs.forEach(function (e, i) {
      var c = colorOf(e.courseId);
      var live = dayCur === t && e.start <= nowHM && nowHM < e.end;
      h += '<button class="lesson' + (e.isExam ? ' exam' : '') + (live ? ' now' : '') + '" data-ev="' + i + '">'
        + '<span class="bar" style="background:' + c.bar + '"></span>'
        + '<span class="tm">' + e.start + '<br>' + e.end + '</span>'
        + '<span class="bd"><span class="nm">'
        + (e.isExam ? '<span class="tag exam">' + esc(e.kind) + '</span>' : '')
        + (e.kind === '실습' || e.kind === 'PBL' ? '<span class="tag lab">' + esc(e.kind) + '</span>' : '')
        + esc(e.title) + '</span>'
        + '<span class="mt">' + esc(e.courseId || '') + (e.prof ? ' · ' + esc(e.prof) : '') + '</span></span>'
        + '</button>';
    });
    return h;
  }

  function viewWeek() {
    var ns = weekNos(), dates = DB.weeks[weekCur], t = today();
    var i0 = ns.indexOf(weekCur);
    var h = '<div class="wknav">'
      + '<button class="arw" data-wk="-1"' + (i0 <= 0 ? ' disabled' : '') + '>&lsaquo;</button>'
      + '<b>' + weekCur + '주차 · ' + md(dates[0]) + ' ~ ' + md(dates[dates.length - 1]) + '</b>'
      + '<button class="arw" data-wk="1"' + (i0 >= ns.length - 1 ? ' disabled' : '') + '>&rsaquo;</button></div>';

    var start = {}, covered = {};
    DB.events.forEach(function (e, idx) {
      var di = dates.indexOf(e.date);
      if (di < 0) return;
      start[di + '|' + e.periods[0]] = idx;
      for (var p = e.periods[0]; p <= e.periods[1]; p++) covered[di + '|' + p] = 1;
    });

    h += '<table class="grid"><thead><tr><th></th>';
    dates.forEach(function (d) {
      h += '<th class="' + (d === t ? 'today' : '') + '">' + dow(d) + '<small>' + md(d) + '</small></th>';
    });
    h += '</tr></thead><tbody>';

    DB.periods.forEach(function (p) {
      h += '<tr><td class="hr">' + p.start.slice(0, 2) + '<br>' + p.start.slice(3) + '</td>';
      dates.forEach(function (d, di) {
        var k = di + '|' + p.no;
        if (start[k] !== undefined) {
          var e = DB.events[start[k]];
          var span = e.periods[1] - e.periods[0] + 1;
          var c = colorOf(e.courseId);
          var style = e.isExam
            ? 'background:var(--danger);color:#fff'
            : 'background:' + c.bg + ';color:' + c.fg;
          h += '<td rowspan="' + span + '"><button class="blk" style="' + style + '" data-ev="' + start[k] + '">'
            + (e.kind !== '강의' ? '<span class="k">' + esc(e.kind) + '</span>' : '')
            + esc(e.title) + '</button></td>';
        } else if (!covered[k]) {
          h += '<td class="slot"></td>';
        }
      });
      h += '</tr>';
    });
    return h + '</tbody></table>';
  }

  function wire() {
    Array.prototype.forEach.call(main.querySelectorAll('[data-day]'), function (b) {
      b.onclick = function () { dayCur = shift(dayCur, +b.dataset.day); render(); };
    });
    Array.prototype.forEach.call(main.querySelectorAll('[data-goto]'), function (b) {
      b.onclick = function () { dayCur = b.dataset.goto; render(); };
    });
    Array.prototype.forEach.call(main.querySelectorAll('[data-wk]'), function (b) {
      b.onclick = function () {
        var ns = weekNos(), i = ns.indexOf(weekCur) + (+b.dataset.wk);
        if (i >= 0 && i < ns.length) { weekCur = ns[i]; render(); }
      };
    });
    Array.prototype.forEach.call(main.querySelectorAll('[data-ev]'), function (b) {
      b.onclick = function () {
        var e = tab === 'today'
          ? DB.events.filter(function (x) { return x.date === dayCur; })[+b.dataset.ev]
          : DB.events[+b.dataset.ev];
        showDetail(e);
      };
    });
  }

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
      b.onclick = function () { dayCur = b.dataset.jump; tab = 'today'; closeSheet(); render(); };
    });
  }

  function showSettings() {
    openSheet('<h3>설정</h3><div class="sub">' + esc(DB ? DB.title : '') + '</div>'
      + (DB ? '<div class="kv"><span>일정</span><b>' + DB.stats.events + '개 · ' + DB.stats.weeks + '주 · 시험 ' + DB.stats.exams + '개</b></div>' : '')
      + '<button class="btn" id="sReplace">엑셀 다시 올리기</button>'
      + '<button class="btn ghost" id="sReset">시간표 삭제</button>'
      + '<div class="note"><b>홈 화면에 추가</b><br>'
      + 'iPhone: Safari 하단 공유 버튼 → 홈 화면에 추가<br>'
      + 'Android: Chrome 우측 상단 ⋮ → 홈 화면에 추가</div>');
    $('sReplace').onclick = function () { closeSheet(); $('file').click(); };
    $('sReset').onclick = function () {
      localStorage.removeItem(KEY); DB = null; closeSheet(); hdr.hidden = true; renderUpload();
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
          } catch (e) {}
        });
        if (!best || !best.events.length) throw new Error('시간표 형식을 인식하지 못했습니다.');
        DB = best; save(DB);
        dayCur = today(); weekCur = weekOf(dayCur); tab = 'today';
        render();
      } catch (e) {
        renderUpload(e.message || '파일을 읽지 못했습니다.');
      }
      ev.target.value = '';
    };
    fr.onerror = function () { renderUpload('파일을 읽지 못했습니다.'); };
    fr.readAsArrayBuffer(f);
  };

  /* ---------- 부팅 ---------- */
  $('tabToday').onclick = function () { tab = 'today'; render(); };
  $('tabWeek').onclick = function () { tab = 'week'; render(); };
  $('gear').onclick = showSettings;
  dark.addEventListener('change', function () { if (DB) render(); });

  function boot(d) {
    DB = d;
    if (!DB) return renderUpload();
    dayCur = today(); weekCur = weekOf(dayCur);
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
