(function () {
  'use strict';

  var KEY = 'medtt.v1';
  var PALETTE = ['#c9736c', '#c4a765', '#6f92b8', '#d49a6f',
                 '#94ab74', '#8e81b5', '#74ada6', '#7cae8a'];
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  var DB = null;
  var tab = 'today';
  var dayCur = null;
  var weekCur = null;

  var $ = function (id) { return document.getElementById(id); };
  var main = $('main'), hdr = $('hdr'), sheet = $('sheet'), scrim = $('scrim');

  /* ---------- 날짜 유틸 (문자열 기준, 타임존 영향 없음) ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toDate(s) { var p = s.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowHM() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
  function shift(s, n) { var d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
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
     흰 글씨가 얹히는 채도 낮은 파스텔 여덟 가지를 과정 순서대로 돌려 쓴다.
     주간표 블록 바탕과 오늘 목록의 세로 막대가 같은 색을 공유한다. */
  function colorOf(cid) {
    var i = DB.courses.indexOf(cid);
    return PALETTE[(i < 0 ? DB.courses.length : i) % PALETTE.length];
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

  function classDays() {
    var seen = {}, out = [];
    DB.events.forEach(function (e) { if (real(e) && !seen[e.date]) { seen[e.date] = 1; out.push(e.date); } });
    return out.sort();
  }
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
    $('hSub').textContent = tab === 'today'
      ? md(dayCur) + ' (' + dow(dayCur) + ')' + (dayCur === today() ? ' · 오늘' : '')
      : weekCur + '주차';
    $('tabToday').setAttribute('aria-selected', tab === 'today');
    $('tabWeek').setAttribute('aria-selected', tab === 'week');

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
    html += tab === 'today' ? viewToday() : viewWeek();
    main.innerHTML = html;

    if ($('ddayBtn')) $('ddayBtn').onclick = showExams;
    wire();
    var cur = main.querySelector('.lesson.now, .blk.now');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center' });
  }

  /* ---------- 오늘 ---------- */
  function viewToday() {
    var t = today(), isToday = dayCur === t, now = nowHM();
    var evs = DB.events.filter(function (e) { return e.date === dayCur; });

    var h = '<div class="daynav">'
      + '<button class="arw" data-day="-1">&lsaquo;</button>'
      + '<b>' + md(dayCur) + ' (' + dow(dayCur) + ')</b>'
      + '<button class="arw" data-day="1">&rsaquo;</button></div>';

    if (!evs.length) {
      var nd = classDays().filter(function (d) { return d > dayCur; })[0];
      return h + '<div class="empty">수업 없음'
        + (nd ? '<br><br><button class="btn ghost" data-goto="' + nd + '">다음 수업일 ' + md(nd) + '(' + dow(nd) + ') 보기</button>' : '')
        + '</div>';
    }

    // 하루 진행률: 첫 수업 시작 ~ 마지막 수업 종료
    if (isToday) {
      var a = mins(evs[0].start), b = mins(evs[evs.length - 1].end), c = mins(now);
      var pct = Math.max(0, Math.min(100, Math.round((c - a) / (b - a) * 100)));
      var left = evs.filter(function (e) { return e.end > now; }).length;
      h += '<div class="prog"><div class="bar"><i style="width:' + pct + '%"></i></div>'
        + '<span>' + (left ? '남은 수업 ' + left + '개' : '오늘 일정 종료') + '</span></div>';
    }

    evs.forEach(function (e, i) {
      var c = colorOf(e.courseId);
      var isNow = isToday && e.start <= now && now < e.end;
      var soon = isToday && !isNow && e.start > now;
      h += '<button class="lesson' + (e.isExam ? ' exam' : '') + (isNow ? ' now' : '') + '" data-ev="' + i + '">'
        + '<span class="bar" style="background:' + c + '"></span>'
        + '<span class="tm">' + e.start + '<br>' + e.end + '</span>'
        + '<span class="bd"><span class="nm">'
        + (isNow ? '<span class="tag now">지금</span>' : '')
        + (e.isExam ? '<span class="tag exam">' + esc(e.kind) + '</span>' : '')
        + (e.kind === '실습' || e.kind === 'PBL' ? '<span class="tag lab">' + esc(e.kind) + '</span>' : '')
        + esc(e.title) + '</span>'
        + '<span class="mt">' + esc(e.courseId || '') + (e.prof ? ' · ' + esc(e.prof) : '')
        + (isNow ? ' · ' + (mins(e.end) - mins(now)) + '분 남음' : '')
        + (soon && i && !(isToday && evs[i - 1].end > now) ? '' : '')
        + '</span></span></button>';
    });
    return h;
  }

  /* ---------- 주간 ---------- */
  function viewWeek() {
    var ns = weekNos(), t = today(), now = nowHM();
    var all = DB.weeks[weekCur];
    var L = live();
    var cols = all.filter(function (d) { return L.days[dowOf(d)]; });

    // 학기 전체를 한 줄로: 시험 있는 주는 점으로 표시
    var strip = '<div class="strip" id="strip">';
    ns.forEach(function (w) {
      var ex = weekExams(w).length;
      var has = DB.events.some(function (e) { return real(e) && DB.weeks[w].indexOf(e.date) >= 0; });
      strip += '<button class="wk' + (w === weekCur ? ' on' : '') + (has ? '' : ' off') + '" data-week="' + w + '">'
        + w + (ex ? '<i></i>' : '') + '</button>';
    });
    strip += '</div>';

    var h = strip + '<div class="wknav">'
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
        var c = e.isExam ? '#c9736c' : colorOf(e.courseId);
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

    return h + '</div></div></div>'
      + '<button class="btn ghost" id="shot">이번 주 시간표 이미지로 저장</button>';
  }

  /* ---------- 주간 시간표를 이미지로 (에타에서 가장 많이 쓰이는 기능) ---------- */
  function wrap(ctx, text, w, max) {
    var out = [], line = '';
    for (var i = 0; i < text.length; i++) {
      var t = line + text[i];
      if (ctx.measureText(t).width > w && line) { out.push(line); line = text[i]; }
      else line = t;
      if (out.length >= max) return out;
    }
    if (line) out.push(line);
    return out.slice(0, max);
  }

  function exportImage() {
    var all = DB.weeks[weekCur], L = live();
    var cols = all.filter(function (d) { return L.days[dowOf(d)]; });

    var R = weekRange(cols), SCALE = 1.55;          // 1분당 px (화면 0.82의 약 2배)
    var PAD = 44, HR = 62, HEAD = 172, FOOT = 92;
    var W = 1080, GW = W - PAD * 2 - HR;
    var CW = GW / cols.length;
    var GH = (R.hi - R.lo) * SCALE;
    var H = HEAD + 54 + GH + FOOT + PAD;

    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var x = cv.getContext('2d');
    // roundRect는 Safari 16.4 미만에 없다. 모서리만 포기하고 계속 그린다.
    if (!x.roundRect) x.roundRect = function (a, b, c, d) { this.rect(a, b, c, d); };
    var FONT = '"Noto Sans KR", -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

    x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);

    // 헤더
    x.fillStyle = '#9aa3a9'; x.font = '400 26px ' + FONT;
    x.fillText(DB.title, PAD, PAD + 30);
    x.fillStyle = '#2f3438'; x.font = '700 44px ' + FONT;
    x.fillText(weekCur + '주차  ' + md(cols[0]) + ' ~ ' + md(cols[cols.length - 1]), PAD, PAD + 88);

    // 요일 헤더
    var gy = HEAD;
    x.textAlign = 'center';
    cols.forEach(function (d, i) {
      x.fillStyle = '#8d969c'; x.font = '500 24px ' + FONT;
      x.fillText(dow(d), PAD + HR + CW * i + CW / 2, gy + 34);
    });
    x.textAlign = 'left';

    // 정시 눈금과 세로 구분선
    var gy0 = gy + 54;
    x.strokeStyle = '#eceff1'; x.lineWidth = 1;
    for (var m = R.lo; m <= R.hi; m += 60) {
      var ly = gy0 + (m - R.lo) * SCALE;
      x.beginPath(); x.moveTo(PAD + HR, ly); x.lineTo(W - PAD, ly); x.stroke();
      if (m === R.hi) continue;
      var hh = m / 60;
      x.fillStyle = '#a8b0b5'; x.font = '400 20px ' + FONT;
      x.textAlign = 'right'; x.fillText(hh > 12 ? hh - 12 : hh, PAD + HR - 14, ly + 25); x.textAlign = 'left';
    }
    cols.forEach(function (_, di) {
      var lx = PAD + HR + CW * di;
      x.beginPath(); x.moveTo(lx, gy0); x.lineTo(lx, gy0 + GH); x.stroke();
    });

    // 블록: 높이가 실제 수업 길이에 비례
    DB.events.forEach(function (e) {
      var di = cols.indexOf(e.date);
      if (di < 0) return;
      var bx = PAD + HR + CW * di + 3, bw = CW - 6;
      var y = gy0 + (mins(e.start) - R.lo) * SCALE;
      var bh = (mins(e.end) - mins(e.start)) * SCALE - 4;
      x.fillStyle = e.isExam ? '#c9736c' : colorOf(e.courseId);
      x.beginPath(); x.roundRect(bx, y, bw, bh, 3); x.fill();

      var ty = y + 28;
      x.fillStyle = '#ffffff';
      if (e.kind !== '강의') {
        x.font = '400 18px ' + FONT; x.globalAlpha = 0.85;
        x.fillText(e.kind, bx + 11, ty); x.globalAlpha = 1; ty += 24;
      }
      x.font = '500 21px ' + FONT;
      var room = Math.max(1, Math.floor((bh - (ty - y) + 14) / 26));
      wrap(x, e.title, bw - 22, room).forEach(function (ln) {
        x.fillText(ln, bx + 11, ty); ty += 26;
      });
      if (e.prof && ty < y + bh - 4) {
        x.font = '400 18px ' + FONT; x.globalAlpha = 0.85;
        x.fillText(e.prof, bx + 11, ty); x.globalAlpha = 1;
      }
    });

    // 푸터: 다음 시험
    var ex = nextExam(), fy = H - PAD - 30;
    if (ex) {
      var n = diffDays(today(), ex.date);
      x.fillStyle = '#c9736c'; x.font = '700 28px ' + FONT;
      var tag = n === 0 ? 'D-DAY' : n > 0 ? 'D-' + n : '';
      x.fillText(tag, PAD, fy);
      x.fillStyle = '#7d868c'; x.font = '400 24px ' + FONT;
      x.fillText(ex.title + '  ·  ' + md(ex.date) + '(' + dow(ex.date) + ')', PAD + x.measureText(tag).width + 60, fy);
    }

    var name = weekCur + '주차_시간표.png';
    cv.toBlob(function (blob) {
      var file = new File([blob], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: weekCur + '주차 시간표' }).catch(function () {});
      } else {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name; a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      }
    }, 'image/png');
  }

  /* ---------- 이벤트 연결 ---------- */
  function gotoWeek(delta) {
    var ns = weekNos(), i = ns.indexOf(weekCur) + delta;
    if (i >= 0 && i < ns.length) { weekCur = ns[i]; render(); }
  }

  function wire() {
    var q = function (sel, fn) { Array.prototype.forEach.call(main.querySelectorAll(sel), fn); };
    q('[data-day]', function (b) { b.onclick = function () { dayCur = shift(dayCur, +b.dataset.day); render(); }; });
    q('[data-goto]', function (b) { b.onclick = function () { dayCur = b.dataset.goto; render(); }; });
    q('[data-wk]', function (b) { b.onclick = function () { gotoWeek(+b.dataset.wk); }; });
    q('[data-week]', function (b) { b.onclick = function () { weekCur = +b.dataset.week; render(); }; });
    q('[data-ev]', function (b) {
      b.onclick = function () {
        var e = tab === 'today'
          ? DB.events.filter(function (x) { return x.date === dayCur; })[+b.dataset.ev]
          : DB.events[+b.dataset.ev];
        showDetail(e);
      };
    });
    if ($('shot')) $('shot').onclick = function () {
      $('shot').textContent = '만드는 중...';
      setTimeout(function () {
        try { exportImage(); } catch (e) { alert('이미지를 만들지 못했습니다.'); }
        $('shot').textContent = '이번 주 시간표 이미지로 저장';
      }, 30);
    };
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
    if (tab === 'today') { dayCur = shift(dayCur, dir); render(); } else gotoWeek(dir);
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
      b.onclick = function () { dayCur = b.dataset.jump; tab = 'today'; closeSheet(); render(); };
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
      localStorage.removeItem(KEY); DB = null; _live = null; closeSheet(); hdr.hidden = true; renderUpload();
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
        DB = best; _live = null; save(DB);
        dayCur = today(); weekCur = weekOf(dayCur); tab = 'today';
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
  $('tabToday').onclick = function () { tab = 'today'; render(); };
  $('tabWeek').onclick = function () { tab = 'week'; render(); };
  $('gear').onclick = showSettings;
  document.addEventListener('visibilitychange', function () { if (!document.hidden && DB) render(); });

  function boot(d) {
    DB = d; _live = null;
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
