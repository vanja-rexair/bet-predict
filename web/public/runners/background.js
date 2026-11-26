/**
 * Radi na Androidu i kad je aplikacija zatvorena (oko svakih 15 minuta, koliko sistem dozvoli).
 * Čita događaje sa servisa koji prati mečeve i šalje obaveštenja za nove važne.
 */
addEventListener('config', (resolve, reject, args) => {
  try {
    CapacitorKV.set('server', args.server || '');
    CapacitorKV.set('level', String(args.level || 2));
    if (args.lastId) CapacitorKV.set('lastId', String(args.lastId));
    resolve();
  } catch (err) {
    reject(err);
  }
});

addEventListener('checkGames', async (resolve, reject) => {
  try {
    const get = (k) => {
      const r = CapacitorKV.get(k);
      return r && r.value ? r.value : '';
    };
    const server = get('server');
    if (!server) return resolve();
    const res = await fetch(server + '/data/events.json');
    if (!res.ok) return resolve();
    const data = await res.json();
    const lastId = Number(get('lastId') || 0);
    const level = Number(get('level') || 2);
    const max = data.events.reduce((m, e) => Math.max(m, e.id), 0);
    // Prvi put samo zapamti gde smo stali, da ne stignu stara obaveštenja.
    if (lastId > 0 && max > lastId) {
      const news = data.events.filter((e) => e.id > lastId && e.importance >= level).slice(0, 6).reverse();
      const at = new Date(Date.now() + 1000);
      if (news.length) CapacitorNotifications.schedule(news.map((e) => ({ id: e.id % 2000000000, title: e.title, body: e.text, scheduleAt: at })));
    }
    if (max !== lastId) CapacitorKV.set('lastId', String(max));
    resolve();
  } catch (err) {
    reject(err);
  }
});
