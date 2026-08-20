function renderPage_(view, ctx) {
  const staffSelect = ctx.isAdmin
    ? `<label>職員:
        <select id="staff" onchange="reloadAttendance()">
          ${renderStaffOptions_(ctx.staffOptions, view.staffId)}
        </select>
      </label>`
    : `<input type="hidden" id="staff" value="${escapeHtml_(view.staffId)}">`;

  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
   body{font-family:sans-serif;max-width:1200px;margin:1em auto;color:#333;padding:0 16px}
   table{border-collapse:collapse;width:100%}
   th,td{border-bottom:1px solid #eee;padding:8px 10px;font-size:14px;text-align:left;white-space:nowrap}
   th{background:#fafafa}
   .ctrl{margin:18px 0;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
   select,button{font-size:14px;padding:6px 10px}
   button{cursor:pointer}
   .loading{opacity:.55;pointer-events:none}
   .error{color:#b00020;margin:10px 0}
   .statusList{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 16px}
   .statusItem{border:1px solid #ddd;border-radius:4px;padding:6px 8px;font-size:13px}
   .statusItem.in{border-color:#2e7d32;background:#f0f8f1}
   .statusText{font-weight:700;margin-right:6px}
   .statusTime{color:#666}
   @media (max-width:700px){
     body{margin:.5em auto;padding:0 10px}
     th,td{font-size:13px;padding:7px 8px}
   }
  </style></head><body>
  <h3 id="pageTitle">${escapeHtml_(view.name)} の勤怠 (${escapeHtml_(view.month)})</h3>
  <div class="ctrl" id="controls">
    ${staffSelect}
    <label>月:
      <select id="month" onchange="reloadAttendance()">
        ${renderMonthOptions_(view.months, view.month)}
      </select>
    </label>
    <button type="button" id="orderButton" onclick="toggleOrder()">
      並び順: <span id="orderLabel">${view.order === 'asc' ? '昇順↑' : '降順↓'}</span>（切替）
    </button>
  </div>
  <div id="message" class="error"></div>
  <div id="statusList" class="statusList">${renderStatusList_(view.currentStatuses)}</div>
  <table>
    <thead>
      <tr><th>日付</th><th>曜日</th><th>休憩</th><th>出勤</th><th>退勤</th>
          <th>法定内残業</th><th>時間外</th><th>実働</th></tr>
    </thead>
    <tbody id="attendanceRows">${view.rowsHtml}</tbody>
  </table>
  <script>
    var currentOrder = '${view.order}';

    function toggleOrder() {
      currentOrder = currentOrder === 'asc' ? 'desc' : 'asc';
      reloadAttendance();
    }

    function reloadAttendance() {
      var controls = document.getElementById('controls');
      var message = document.getElementById('message');
      var month = document.getElementById('month').value;
      var staff = document.getElementById('staff').value;

      message.textContent = '';
      controls.classList.add('loading');

      google.script.run
        .withSuccessHandler(function(res) {
          controls.classList.remove('loading');
          if (!res || !res.ok) {
            message.textContent = res && res.error ? res.error : '読み込みに失敗しました。';
            return;
          }
          currentOrder = res.order;
          document.getElementById('pageTitle').textContent = res.title;
          document.getElementById('attendanceRows').innerHTML = res.rowsHtml;
          document.getElementById('statusList').innerHTML = res.statusHtml;
          document.getElementById('month').innerHTML = res.monthOptionsHtml;
          document.getElementById('month').value = res.month;
          document.getElementById('orderLabel').textContent = res.orderLabel;
        })
        .withFailureHandler(function(err) {
          controls.classList.remove('loading');
          message.textContent = err && err.message ? err.message : '読み込みに失敗しました。';
        })
        .getAttendanceData(month, currentOrder, staff);
    }
  </script>
  </body></html>`;
}

function renderRows_(summary) {
  let rows = '';

  summary.forEach(r => {
    rows += '<tr>' +
      '<td>' + escapeHtml_(r.date) + '</td>' +
      '<td>' + escapeHtml_(r.week) + '</td>' +
      '<td>' + escapeHtml_(fmtMin_(r.breakM)) + '</td>' +
      '<td>' + escapeHtml_(r.inStr) + '</td>' +
      '<td>' + escapeHtml_(r.outStr) + '</td>' +
      '<td>' + escapeHtml_(r.legalOtM > 0 ? fmtMin_(r.legalOtM) : '') + '</td>' +
      '<td>' + escapeHtml_(r.statutoryOtM > 0 ? fmtMin_(r.statutoryOtM) : '') + '</td>' +
      '<td>' + escapeHtml_(fmtMin_(r.workM)) + '</td>' +
    '</tr>';
  });

  return rows || '<tr><td colspan="8">この月の記録はありません</td></tr>';
}

function renderStatusList_(statuses) {
  return (statuses || []).map(s => {
    const isIn = s.status === 'in';
    return '<div class="statusItem ' + (isIn ? 'in' : 'out') + '">' +
      '<span class="statusText">' + escapeHtml_(s.name) + ' ' + (isIn ? 'IN' : 'OUT') + '</span>' +
      '<span class="statusTime">' + escapeHtml_(s.lastTime || '') + '</span>' +
    '</div>';
  }).join('');
}

function renderMonthOptions_(months, selectedMonth) {
  return months.map(m =>
    '<option value="' + escapeHtml_(m) + '"' +
    (m === selectedMonth ? ' selected' : '') + '>' +
    escapeHtml_(m) + '</option>'
  ).join('');
}

function getStaffOptions_() {
  return Object.keys(STAFF).map(id => ({
    id: id,
    name: STAFF[id].name
  }));
}

function renderStaffOptions_(options, selectedStaffId) {
  return options.map(opt =>
    '<option value="' + escapeHtml_(opt.id) + '"' +
    (opt.id === selectedStaffId ? ' selected' : '') + '>' +
    escapeHtml_(opt.name) + '</option>'
  ).join('');
}

function isValidMonth_(month) {
  return /^\d{4}-\d{2}$/.test(String(month || ''));
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
