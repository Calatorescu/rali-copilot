// RALI 2 · ble.js — sursa de viteză din mașină (Commander/CAN), EXPERIMENTAL.
//
// Premiul: odometru de precizie Blunik, din viteza reală a roților, imun total la GPS.
// Starea cinstită: NU știm încă dacă/ cum expune Enhance datele prin BLE către aplicații
// terțe — modulul e o priză standard în care se poate băga orice caracteristică BLE
// care notifică viteza. Config: UUID serviciu + UUID caracteristică + formulă de decodare.
// Până la confirmare, aplicația merge complet fără el (GPS-ul rămâne implicitul).

export function makeBleSpeed({ onSpeedKmh, onStatus }) {
  let device = null, char = null;

  async function connect({ serviceUuid, charUuid, decode }) {
    if (!('bluetooth' in navigator)) { onStatus('Web Bluetooth indisponibil pe acest browser.'); return false; }
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: serviceUuid ? [{ services: [serviceUuid] }] : undefined,
        acceptAllDevices: !serviceUuid,
        optionalServices: serviceUuid ? [serviceUuid] : []
      });
      const server = await device.gatt.connect();
      const svc = await server.getPrimaryService(serviceUuid);
      char = await svc.getCharacteristic(charUuid);
      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', e => {
        try {
          const kmh = (decode || defaultDecode)(e.target.value);
          if (isFinite(kmh) && kmh >= 0 && kmh < 300) onSpeedKmh(kmh);
        } catch (err) {}
      });
      onStatus(`Conectat: ${device.name || 'dispozitiv BLE'}`);
      return true;
    } catch (e) {
      onStatus('BLE: ' + (e && e.message ? e.message : 'conexiune eșuată'));
      return false;
    }
  }

  // presupunere de lucru: uint16 little-endian, sutimi de km/h — SE AJUSTEAZĂ după
  // ce protocolul real e confirmat
  function defaultDecode(dv) { return dv.getUint16(0, true) / 100; }

  return {
    connect,
    disconnect() { try { device && device.gatt.disconnect(); } catch (e) {} device = null; char = null; },
    get connected() { return !!(device && device.gatt && device.gatt.connected); }
  };
}
