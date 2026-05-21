/**
 * Berkeley CRM — Helpers
 * Pure utility functions.
 */

export function daysSince(date) {
  if (!date) return null;
  return Math.floor((new Date() - new Date(date)) / 864e5);
}

export function formatDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('sv-SE');
}

export function formatSEK(amount) {
  return Number(amount).toLocaleString('sv-SE') + ' kr';
}

export function visitColor(days) {
  if (days === null) return '#EAC435';
  if (days <= 30) return '#2ECC71';
  if (days < 60)  return '#EAC435';
  if (days < 90)  return '#E67E22';
  return '#E74C3C';
}

export function visitCategory(days) {
  if (days === null) return 'novisit';
  if (days <= 30) return 'green';
  if (days < 60)  return 'yellow';
  if (days < 90)  return 'orange';
  return 'red';
}

export function makeMarkerIcon(color) {
  return L.divIcon({
    html: `<div style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:pointer;">
      <div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -10],
    className: ''
  });
}

export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function googleMapsUrl(customer) {
  if (customer.address) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(customer.address + ', ' + customer.zip + ' ' + customer.city)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.city)}`;
}

export function downloadICS({ title, date, duration = 60, location, description }) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date(date);
  const start = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const end = new Date(d.getTime() + duration * 60000);
  const endStr = `${end.getFullYear()}${pad(end.getMonth()+1)}${pad(end.getDate())}T${pad(end.getHours())}${pad(end.getMinutes())}00`;
  const uid = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '@berkeleycrm';
  const esc = (s) => (s || '').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Berkeley CRM//SV',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${start}`,
    `DTEND:${endStr}`,
    `SUMMARY:${esc(title)}`,
    location ? `LOCATION:${esc(location)}` : '',
    description ? `DESCRIPTION:${esc(description)}` : '',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = title.replace(/[^a-zA-ZåäöÅÄÖ0-9 ]/g, '').replace(/\s+/g, '_') + '.ics';
  a.click();
}

export async function geocodeAddress(query) {
  const queries = [
    query + ', Sweden',
    query.replace(/^[^,]+,\s*/, '') + ', Sweden',
    query.split(',').slice(-2).join(',').trim() + ', Sweden'
  ];
  for (const q of queries) {
    try {
      const params = new URLSearchParams({ q, format: 'json', limit: 1, countrycodes: 'se' });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { 'User-Agent': 'BerkeleyCRM/2.0' }
      });
      const data = await res.json();
      if (data.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    } catch { /* try next */ }
  }
  return null;
}
