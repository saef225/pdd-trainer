/**
 * Приёмник результатов тренажёра ПДД.
 * Вставьте этот код в «Расширения → Apps Script» вашей Google Таблицы
 * и опубликуйте как веб-приложение (см. ИНСТРУКЦИЯ.md).
 *
 * Листы создаются автоматически:
 *   «Попытки»        — одна строка на каждую попытку (итог, % , время, номера ошибок, текст для чата)
 *   «Ошибки»         — одна строка на каждый неверный или пропущенный вопрос (с правильным ответом и пояснением)
 *   «Частые ошибки»  — сводка: какие вопросы вы путаете чаще всего
 *   «Журнал»         — проверки связи
 */

var SHEETS = {
  attempts: { name: 'Попытки', head: ['Дата', 'Имя', 'Режим', 'Название', 'Всего', 'Верно', 'Ошибок', 'Пропущено', '%', 'Сдал', 'Время, с', 'Ошибки (билет-вопрос)', 'Текст для чата', 'ID'] },
  mistakes: { name: 'Ошибки', head: ['Дата', 'Имя', 'Попытка', 'Билет', 'Вопрос №', 'Тема', 'Статус', 'Вопрос', 'Мой ответ', 'Правильный ответ', 'Пояснение', 'Картинка', 'ID попытки'] },
  log: { name: 'Журнал', head: ['Дата', 'Имя', 'Событие'] }
};
var MODES = { ticket: 'Билет', exam: 'Экзамен', marathon: 'Марафон', wrong: 'Работа над ошибками', topic: 'Тема', search: 'Поиск' };

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var date = d.date ? new Date(d.date) : new Date();

    if (d.type === 'ping') {
      sheet_(ss, SHEETS.log).appendRow([date, d.name || '', 'Проверка связи ✓']);
      return out_('pong');
    }
    if (d.type !== 'attempt') return out_('unknown type');

    var att = sheet_(ss, SHEETS.attempts);
    // защита от повторной отправки одной и той же попытки
    if (d.id && att.getLastRow() > 1 &&
        att.getRange(2, 14, att.getLastRow() - 1, 1).createTextFinder(d.id).matchEntireCell(true).findNext()) {
      return out_('duplicate');
    }

    var mistakes = d.mistakes || [];
    att.appendRow([
      date, d.name, MODES[d.mode] || d.mode, d.title, d.total, d.correct, d.wrong, d.skipped,
      d.percent / 100, d.passed ? 'да' : 'нет', d.duration,
      mistakes.map(function (m) { return m.ticket + '-' + m.num; }).join(', '),
      d.chat || '', d.id
    ]);
    var r = att.getLastRow();
    att.getRange(r, 9).setNumberFormat('0%');
    att.getRange(r, 10).setBackground(d.passed ? '#d9f2e3' : '#fbe1e1');

    if (mistakes.length) {
      var ms = sheet_(ss, SHEETS.mistakes);
      var rows = mistakes.map(function (m) {
        return [date, d.name, d.title, m.ticket, m.num, m.topic, m.status, m.question, m.your, m.correct, m.tip, m.image, d.id];
      });
      ms.getRange(ms.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
    ensureSummary_(ss);
    return out_('ok');
  } catch (err) {
    return out_('error: ' + err);
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return out_('Приёмник ПДД работает. Отправляйте результаты с сайта (POST).');
}

function sheet_(ss, cfg) {
  var sh = ss.getSheetByName(cfg.name);
  if (!sh) {
    sh = ss.insertSheet(cfg.name);
    sh.appendRow(cfg.head);
    sh.getRange(1, 1, 1, cfg.head.length).setFontWeight('bold').setBackground('#e8f0ff');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('dd.MM.yyyy HH:mm');
    if (cfg === SHEETS.mistakes) { sh.setColumnWidth(8, 380); sh.setColumnWidth(9, 220); sh.setColumnWidth(10, 220); sh.setColumnWidth(11, 420); }
    if (cfg === SHEETS.attempts) { sh.setColumnWidth(13, 300); }
    sh.getRange(1, 1, 1, cfg.head.length).createFilter();
  }
  return sh;
}

function ensureSummary_(ss) {
  if (ss.getSheetByName('Частые ошибки')) return;
  var sh = ss.insertSheet('Частые ошибки');
  sh.getRange('A1').setFormula(
    "=QUERY('Ошибки'!A:M, \"select D, E, F, H, J, K, count(A) where D is not null group by D, E, F, H, J, K order by count(A) desc label D 'Билет', E 'Вопрос №', F 'Тема', H 'Вопрос', J 'Правильный ответ', K 'Пояснение', count(A) 'Сколько раз ошибся'\", 1)"
  );
  sh.setFrozenRows(1);
  sh.setColumnWidth(4, 380); sh.setColumnWidth(5, 220); sh.setColumnWidth(6, 420);
}

function out_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.TEXT);
}

/* ---------- Меню в таблице: быстрые выгрузки для чата ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ПДД')
    .addItem('Текст последней попытки для чата', 'showLastChat')
    .addItem('Все ошибки выбранного имени для чата', 'showMistakesForName')
    .addItem('Найти по слову в ошибках', 'searchMistakes')
    .addToUi();
}

function showLastChat() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.attempts.name);
  if (!sh || sh.getLastRow() < 2) return SpreadsheetApp.getUi().alert('Попыток пока нет');
  showText_('Последняя попытка', sh.getRange(sh.getLastRow(), 13).getValue());
}

function showMistakesForName() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Чьи ошибки выгрузить?', 'Имя (как в столбце «Имя»). Пусто — все.', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var name = resp.getResponseText().trim().toLowerCase();
  showText_('Ошибки' + (name ? ': ' + name : ''), mistakesText_(function (r) { return !name || String(r[1]).toLowerCase() === name; }));
}

function searchMistakes() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('Поиск по ошибкам', 'Слово или номер (например: обгон, 3.20, «Билет 12»)', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var q = resp.getResponseText().trim().toLowerCase();
  if (!q) return;
  showText_('Найдено по «' + q + '»', mistakesText_(function (r) { return r.join(' ').toLowerCase().indexOf(q) >= 0; }));
}

function mistakesText_(filter) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEETS.mistakes.name);
  if (!sh || sh.getLastRow() < 2) return 'Ошибок пока нет';
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 13).getValues().filter(filter);
  var seen = {}, lines = [], i = 0;
  rows.reverse().forEach(function (r) {
    var k = r[3] + '-' + r[4];
    if (seen[k]) { seen[k].n++; return; }
    seen[k] = { n: 1 };
    lines.push({ k: k, r: r });
  });
  if (!lines.length) return 'Ничего не найдено';
  return lines.map(function (x) {
    var r = x.r; i++;
    return i + ') Б' + r[3] + ' В' + r[4] + (r[5] ? ' [' + r[5] + ']' : '') + (seen[x.k].n > 1 ? ' (ошибок: ' + seen[x.k].n + ')' : '') + ': ' + r[7] +
      '\n   Правильно: ' + r[9] + '\n   Пояснение: ' + r[10];
  }).join('\n');
}

function showText_(title, text) {
  var html = HtmlService.createHtmlOutput(
    '<textarea id="t" style="width:100%;height:380px;font:13px monospace">' +
    String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;') +
    '</textarea><br><button onclick="t.select();document.execCommand(\'copy\')">Скопировать</button>'
  ).setWidth(720).setHeight(460);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}
