/**
 * What the served page adds on top of the written one: staying current while you watch.
 *
 * The first choice is a stream — one connection, events pushed as they happen, nothing wasted when
 * nothing changes. The second is polling, and it exists because of something measured rather than
 * imagined: a Cloudflare quick tunnel buffers the body of a streaming response. Through one, the
 * page connects, `onopen` fires, and then nothing arrives for as long as the build runs. Every
 * content type behaves the same way, and no amount of padding or `no-transform` changes it.
 *
 * So the page does not trust `onopen`. The server sends a `ready` event immediately; if that has
 * not arrived within a few seconds the stream is being held somewhere, and the page stops waiting
 * and starts asking instead. Polling is worse — a second or two of latency, a request every couple
 * of seconds — and it is what makes the console work from a phone, which is the point.
 */

// How long to wait for the server's first event before deciding the stream is being buffered.
const STREAM_DEADLINE_MS = 6000;
const POLL_MS = 2000;

export const STREAM_SCRIPT = `
const base = location.pathname.replace(/\\/+$/, '');
let failures = 0;
let source = null;
let polling = null;
// What to ask for next, and what has already been put on the page. They are not the same thing:
// the first is a request, the second is what the reader can already see.
const offsets = {};
const written = {};

/** One pane per lane, created the first time that lane writes anything. */
function pane(id, title) {
  let box = document.getElementById('console');
  if (!box) {
    box = document.createElement('section');
    box.id = 'console';
    box.className = 'card';
    box.innerHTML = '<div class="card-head"><div class="card-title">Lane output' +
      '<small>What each agent is writing, as it writes it</small></div></div>';
    // Appended to .main rather than into the routed view, so moving between pages does not throw
    // away the output someone is watching.
    document.querySelector('.main').append(box);
  }
  let lane = document.getElementById('lane-' + id);
  if (!lane) {
    lane = document.createElement('div');
    lane.className = 'lane';
    lane.id = 'lane-' + id;
    lane.innerHTML = '<h3></h3><pre class="log"></pre>';
    lane.querySelector('h3').textContent = title;
    box.append(lane);
  }
  return lane.querySelector('pre');
}

/**
 * Append a chunk of a lane's output, once.
 *
 * The same bytes can arrive twice: the stream sends the tail when a page connects, polling asks
 * for it again after a fallback, and a reconnect replays it. Each chunk says which byte of the
 * file it ends at, so a chunk ending where the last one ended is the same chunk and is dropped.
 * A chunk ending *earlier* is not a duplicate — the log was replaced, a lane redispatched over
 * the same worktree — so that one is kept and the mark moves back with it.
 */
function writeLog(entry) {
  if (!entry.text) return;
  const at = entry.offset;
  if (at !== undefined && at !== null && written[entry.id] === at) return;
  if (at !== undefined && at !== null) written[entry.id] = at;
  const box = pane(entry.id, entry.feature + ' \\u00b7 ' + entry.lane);
  // A log is followed as it is written, so it stays at the end unless the reader scrolled away.
  const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.textContent += entry.text;
  if (atEnd) box.scrollTop = box.scrollHeight;
}

function stamp(how) {
  const badge = document.getElementById('updated');
  if (badge) badge.textContent = new Date().toLocaleTimeString();
  const live = document.querySelector('.live');
  if (live) live.dataset.how = how;
}

// --- Polling: slower, and works through anything that speaks HTTP -----------------------------

async function pollOnce() {
  try {
    const [state, logs] = await Promise.all([
      fetch(base + '/state.json', { cache: 'no-store' }).then((response) => (response.ok ? response.json() : null)),
      fetch(base + '/logs.json?offsets=' + encodeURIComponent(JSON.stringify(offsets)), { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null)),
    ]);
    if (state) { window.__update__(state); stamp('polling'); }
    for (const entry of (logs && logs.logs) || []) {
      offsets[entry.id] = entry.offset;
      writeLog(entry);
    }
    document.body.classList.remove('offline');
  } catch {
    document.body.classList.add('offline');
  }
}

/**
 * One request at a time, with the gap measured from the end of the last one.
 *
 * A phone on a tunnel takes a second or two per round trip. On an interval, the next poll leaves
 * before the previous has answered, so several requests are in flight all asking from the same
 * byte — and every one of them brings back the same chunk of log. Waiting for the answer before
 * asking again is what makes "since byte N" mean anything.
 */
function startPolling(why) {
  if (polling) return;
  if (source) { source.close(); source = null; }
  polling = true;
  console.info('vibecheck: ' + why + ' — asking every ' + ${POLL_MS} + 'ms instead');
  const note = document.querySelector('.live');
  if (note) note.title = why + '. Updating by polling instead of streaming.';
  const again = () => { if (polling) setTimeout(() => pollOnce().then(again), ${POLL_MS}); };
  pollOnce().then(again);
}

// --- Streaming: the first choice ---------------------------------------------------------------

function connect() {
  source = new EventSource(base + '/events');

  // onopen only means the headers arrived, which a buffering proxy sends straight through. The
  // deadline is on the first real event, because that is the thing a proxy actually withholds.
  const deadline = setTimeout(() => startPolling('the stream connected but sent nothing'), ${STREAM_DEADLINE_MS});
  const alive = () => { clearTimeout(deadline); failures = 0; document.body.classList.remove('offline'); };

  source.addEventListener('ready', alive);

  source.addEventListener('state', function (event) {
    alive();
    window.__update__(JSON.parse(event.data));
    stamp('streaming');
  });

  source.addEventListener('log', function (event) {
    alive();
    const entry = JSON.parse(event.data);
    offsets[entry.id] = entry.offset ?? offsets[entry.id];
    writeLog(entry);
  });

  source.onerror = function () {
    clearTimeout(deadline);
    source.close();
    source = null;
    failures += 1;
    document.body.classList.add('offline');
    // Three failures means the stream is not coming back on its own. Polling is not as good, and
    // it is a great deal better than a page that looks live and quietly stopped updating.
    if (failures > 2) return startPolling('the stream kept dropping');
    setTimeout(connect, 1500);
  };
}

if (window.EventSource) connect();
else startPolling('this browser has no EventSource');
`;
