/* 의대 시간표 엑셀 파서
   가정: "N주" 앵커 셀 + 오른쪽 날짜 6칸 + 아래 "n(HH:MM-HH:MM)" 교시행 그리드
   셀 문법: (과정-유형)강의명-교수명 */
(function (root) {
  'use strict';

  var RE_WEEK   = /^\s*(\d+)\s*주\s*$/;
  var RE_PERIOD = /^\s*(\d+)\s*\(\s*(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})\s*\)/;
  var RE_PROF   = /[-_]\s*([가-힣]{2,4}[A-Za-z]?)\s*$/;
  var RE_TAG    = /^\(([^)]*)\)\s*([\s\S]*)$/;

  var HOLIDAY = ['추석', '연휴', '개천절', '한글날', '성탄절', '신정', '대체 공휴일', '자율학습', '삼일절', '어린이날', '현충일', '광복절'];
  var KINDS   = ['실습시험', '형성평가', '종합평가', 'PBL', '시험', '실습'];

  var ALIAS = { '인구1': '인체구조I', '인구2': '인체구조II', '세포': '세포조절', '대사': '인체대사' };
  var GUESS = [
    ['기초의학 종합평가', '기초의학 종합평가'],
    ['세포조절', '세포조절'], ['인체대사', '인체대사'],
    ['인체구조1', '인체구조I'], ['인체구조2', '인체구조II'],
    ['해부실습', '인체구조I'], ['사회봉사', '사회봉사'], ['의료와 사회', '의료와 사회']
  ];
  var EXAM_KINDS = { '시험': 1, '실습시험': 1, '형성평가': 1, '종합평가': 1 };

  function norm(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function k(r, c) { return r + ',' + c; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /* 날짜 셀 → 'YYYY-MM-DD'. 엑셀 serial(숫자)을 우선 처리해 타임존 오차를 없앤다. */
  function toYMD(v, XLSX) {
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var d = XLSX.SSF.parse_date_code(v);
      return d ? d.y + '-' + pad(d.m) + '-' + pad(d.d) : null;
    }
    if (v instanceof Date) return ymd(v);
    if (typeof v === 'string') {
      var m = /^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/.exec(v.trim());
      if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    }
    return null;
  }

  function parseCell(text) {
    var t = norm(text);
    if (!t || t === '*' || t === '-') return null;

    for (var i = 0; i < HOLIDAY.length; i++) {
      if (t.indexOf(HOLIDAY[i]) !== -1) return { course: null, kind: '휴일', title: t, prof: null };
    }

    var course = null, kind = null, rest = t;
    var m = RE_TAG.exec(t);
    if (m) {
      var parts = m[1].split(/\s*-\s*/);
      course = norm(parts[0]) || null;
      if (parts.length > 1) kind = norm(parts[1]);
      rest = norm(m[2]);
    }

    var prof = null;
    var pm = RE_PROF.exec(rest);
    if (pm) { prof = pm[1]; rest = norm(rest.slice(0, pm.index)); }

    var hay = kind || rest;
    kind = '강의';
    for (var j = 0; j < KINDS.length; j++) {
      if (hay.indexOf(KINDS[j]) !== -1) { kind = KINDS[j]; break; }
    }
    return { course: course, kind: kind, title: rest || t, prof: prof };
  }

  function resolveCourse(ev) {
    if (ev.course) return ALIAS[ev.course] || ev.course;
    for (var i = 0; i < GUESS.length; i++) {
      if (ev.title.indexOf(GUESS[i][0]) !== -1) return GUESS[i][1];
    }
    return null;
  }

  function parseTimetable(ws, XLSX) {
    var ref = ws['!ref'];
    if (!ref) throw new Error('빈 시트입니다.');
    var range = XLSX.utils.decode_range(ref);

    var ownerOf = new Map(), spanOf = new Map();
    (ws['!merges'] || []).forEach(function (mg) {
      spanOf.set(k(mg.s.r, mg.s.c), { rows: mg.e.r - mg.s.r + 1, cols: mg.e.c - mg.s.c + 1 });
      for (var r = mg.s.r; r <= mg.e.r; r++)
        for (var c = mg.s.c; c <= mg.e.c; c++) ownerOf.set(k(r, c), k(mg.s.r, mg.s.c));
    });

    function cell(r, c) { return ws[XLSX.utils.encode_cell({ r: r, c: c })] || null; }
    function raw(r, c) { var x = cell(r, c); return x ? x.v : null; }
    function isFollower(r, c) { var o = ownerOf.get(k(r, c)); return !!o && o !== k(r, c); }

    var anchors = [];
    for (var r = range.s.r; r <= range.e.r; r++) {
      for (var c = range.s.c; c <= range.e.c; c++) {
        var wm = RE_WEEK.exec(norm(raw(r, c)));
        if (wm) anchors.push({ r: r, c: c, week: parseInt(wm[1], 10) });
      }
    }
    if (!anchors.length) throw new Error('"N주" 형식의 주차 표시를 찾지 못했습니다.');

    var events = [];
    anchors.forEach(function (a) {
      var days = [];
      for (var d = 1; d <= 6 && a.c + d <= range.e.c; d++) days.push(toYMD(raw(a.r, a.c + d), XLSX));

      // 교시행은 앵커 아래로 '연속'해서만 존재한다. 끊기면 그 블록은 끝.
      var started = false;
      for (var pr = a.r + 1; pr <= range.e.r; pr++) {
        var pm = RE_PERIOD.exec(norm(raw(pr, a.c)));
        if (!pm) { if (started || pr > a.r + 3) break; else continue; }
        started = true;
        var startNo = parseInt(pm[1], 10);
        var start = pad(+pm[2]) + ':' + pm[3];

        for (var di = 0; di < days.length; di++) {
          if (!days[di]) continue;
          var cc = a.c + di + 1;
          if (isFollower(pr, cc)) continue;
          var rawv = raw(pr, cc);
          if (rawv == null) continue;
          var ev = parseCell(rawv);
          if (!ev) continue;

          var sp = spanOf.get(k(pr, cc)) || { rows: 1, cols: 1 };
          var endRow = pr + sp.rows - 1;
          var em = RE_PERIOD.exec(norm(raw(endRow, a.c))) || pm;

          ev.week = a.week;
          ev.date = days[di];
          ev.start = start;
          ev.end = pad(+em[4]) + ':' + em[5];
          ev.periods = [startNo, parseInt(em[1], 10)];
          ev.raw = norm(rawv);
          ev.courseId = resolveCourse(ev);
          ev.isExam = !!EXAM_KINDS[ev.kind];
          events.push(ev);
        }
      }
    });

    var byWeek = {};
    events.forEach(function (e) {
      if (!e.courseId || e.kind === '휴일') return;
      (byWeek[e.week] = byWeek[e.week] || {});
      byWeek[e.week][e.courseId] = (byWeek[e.week][e.courseId] || 0) + 1;
    });
    events.forEach(function (e) {
      if (e.courseId || e.kind === '휴일') return;
      var tally = byWeek[e.week] || {}, best = null, n = 0;
      Object.keys(tally).forEach(function (cid) { if (tally[cid] > n) { n = tally[cid]; best = cid; } });
      e.courseId = best || '기타';
      e.inferred = true;
    });

    events.sort(function (x, y) {
      return x.date < y.date ? -1 : x.date > y.date ? 1 : x.start < y.start ? -1 : x.start > y.start ? 1 : 0;
    });

    var weeks = {};
    anchors.forEach(function (a) {
      var ds = [];
      for (var d = 1; d <= 6 && a.c + d <= range.e.c; d++) {
        var dv = toYMD(raw(a.r, a.c + d), XLSX);
        if (dv) ds.push(dv);
      }
      if (ds.length) weeks[a.week] = ds;
    });

    var periods = [], seen = {};
    anchors.forEach(function (a) {
      var on = false;
      for (var pr = a.r + 1; pr <= range.e.r; pr++) {
        var pm = RE_PERIOD.exec(norm(raw(pr, a.c)));
        if (!pm) { if (on || pr > a.r + 3) break; else continue; }
        on = true;
        if (!seen[pm[1]]) {
          seen[pm[1]] = 1;
          periods.push({ no: +pm[1], start: pad(+pm[2]) + ':' + pm[3], end: pad(+pm[4]) + ':' + pm[5] });
        }
      }
    });
    periods.sort(function (x, y) { return x.no - y.no; });

    var courses = [], cseen = {};
    events.forEach(function (e) {
      if (e.kind === '휴일' || !e.courseId || cseen[e.courseId]) return;
      cseen[e.courseId] = 1; courses.push(e.courseId);
    });

    return {
      title: norm(raw(range.s.r, range.s.c)) || '시간표',
      events: events, weeks: weeks, periods: periods, courses: courses,
      stats: { events: events.length, weeks: anchors.length, exams: events.filter(function (e) { return e.isExam; }).length }
    };
  }

  var api = { parseTimetable: parseTimetable, parseCell: parseCell };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimetableParser = api;
})(typeof self !== 'undefined' ? self : this);
