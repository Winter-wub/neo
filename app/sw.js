var C='mochi-v1',F=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png'].concat(
['cat_chirp_short','cat_meow_long_sleepy','cat_meow_med_curious','cat_meow_short_happy','cat_meow_short_startled','cat_purr_long','cat_purr_med','cat_trill_med','dog_bark_med','dog_bark_short','dog_yelp_long','mouse_squeak_long','mouse_squeak_med','mouse_squeak_short'].map(function(n){return 'sounds/'+n+'.mp3'}));
self.addEventListener('install',function(e){e.waitUntil(caches.open(C).then(function(c){return c.addAll(F)}))});
self.addEventListener('fetch',function(e){e.respondWith(caches.match(e.request).then(function(r){return r||fetch(e.request)}))});
