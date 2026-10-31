import { ALARM, createService } from './service';
const service = createService();
const log = (error: unknown) => console.error('Tabsence local event', error);
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await Promise.all([
      service.inject('activity'),
      service.initialize().then(service.mountLocal),
    ]);
  } catch (error) {
    log(error);
  }
});
chrome.runtime.onStartup.addListener(async () => {
  try {
    await service.initialize().then(service.mountLocal);
  } catch (error) {
    log(error);
  }
});
chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    await service.onCreated(tab);
  } catch (error) {
    log(error);
  }
});
chrome.tabs.onRemoved.addListener(async (id) => {
  try {
    await service.onRemoved(id);
  } catch (error) {
    log(error);
  }
});
chrome.tabs.onUpdated.addListener(async (id, change, tab) => {
  try {
    await service.onUpdated(id, change, tab);
  } catch (error) {
    log(error);
  }
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  void service.dispatch(message, sender).then(respond);
  return true;
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM) {
    try {
      await service.sweep();
    } catch (error) {
      log(error);
    }
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.inactive_tabs_settings || changes.inactive_tabs_threshold_disabled)) {
    void service.updateBadge().catch(log);
  }
});
void service.initialize().catch(log);
