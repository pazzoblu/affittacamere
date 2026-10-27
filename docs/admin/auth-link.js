// Prima che Supabase legga e ripulisca l'indirizzo, ricorda se si arriva da un link di attivazione o di recupero password
window.__authLinkType = (location.hash.match(/[#&]type=(\w+)/) || [])[1] || '';
