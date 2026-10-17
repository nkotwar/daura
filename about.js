/* TASC Connect · About: a short field guide (opens from the logo in the header, or Profile → About TASC Connect). */

function aboutHTML() {
  const ch = (n, kicker, title, body) => `<section class="ab-ch"><div class="ab-num">${n}</div><div class="ab-body"><div class="ab-kicker">${kicker}</div><h3>${title}</h3>${body}</div></section>`;
  return `<article class="ab">
  <header class="ab-hero">
    <img src="icon-192.png" alt="" class="ab-icon">
    <h2>TASC Connect</h2>
    <p class="ab-dek">A short field guide to visiting the places allotted to you, and keeping a record of every visit.</p>
  </header>

  ${ch('I', 'The idea', 'Every allotted place, visited and on record', `
    <p class="ab-lede">TASC Connect holds the list of places the Regional Office wants visited: hospitals, schools, trusts, places of worship and any you add yourself. Each is allotted to someone with a date. You go, you log what happened with a few photos, your branch head checks it, and the Regional Office sees the whole region at a glance.</p>
    <blockquote>One visit leads to the next. Set a follow-up date and TASC Connect reminds you.</blockquote>`)}

  ${ch('II', 'A visit, start to finish', 'Six steps', `
    <ol class="ab-steps">
      <li><b>Open</b><span>My visits lists your allotted places and reports; tap Overdue or Today to see what is due.</span></li>
      <li><b>Go</b><span>Find on Maps takes you there.</span></li>
      <li><b>Report</b><span>Submit Visit Report: who you met, their banking, the potential and what came of it.</span></li>
      <li><b>Photograph</b><span>Up to four. Photos taken in TASC Connect are stamped and pin the place on the map.</span></li>
      <li><b>Verify</b><span>Your branch head checks it. Branch heads' and RO visits go to the Regional Office.</span></li>
      <li><b>Follow up</b><span>Once verified, add Visit 2, 3… or close it: account opened, rejected or not feasible.</span></li>
    </ol>`)}

  ${ch('III', 'Who sees what', 'Your Gmail, your profile, your visits', `
    <div class="ab-chain"><span>Gmail<br><small>signed in with Google</small></span><i>→</i><span>Your profile<br><small>Emp ID, confirmed once</small></span><i>→</i><span>What you see<br><small>by your role</small></span></div>
    <p>Staff see their own visits in full, and a short summary of everyone's visits to a place: who went, when, and what came of it. Branch heads also see their branch's visits, to verify them. The Regional Office sees everything. Phone numbers and photos stay with the people who need them.</p>`)}

  ${ch('IV', 'Reading the lists', 'Five colours', `
    <div class="ab-legend">
      <div><i class="ab-dot over"></i><b>Overdue</b><span>The date has passed and nobody has logged it.</span></div>
      <div><i class="ab-dot due"></i><b>Coming up</b><span>Due today or later.</span></div>
      <div><i class="ab-dot vis"></i><b>Visited</b><span>Logged, waiting for the branch head's check.</span></div>
      <div><i class="ab-dot ver"></i><b>Verified</b><span>Checked and locked. Ask the admin to unverify if it needs a correction.</span></div>
      <div><i class="ab-dot hold"></i><b>On hold</b><span>You asked to reassign or remove it. It is locked and off your overdue list until the admin decides.</span></div>
    </div>
    <p>If a colleague visits a place allotted to you, it counts as visited, and shows who went.</p>`)}

  ${ch('V', 'Asking the admin', 'Requests', `
    <p>Too far, closed down, or a mistake in a visit you can no longer change? Ask from the place or the visit: <em>reassign</em>, <em>remove</em>, <em>delete</em> or <em>unverify</em>. One request at a time; the admin approves or declines, and you see the answer.</p>`)}

  ${ch('VI', 'Where your data lives', 'On the server, with a copy on your phone', `
    <p>Visits and photos are kept in India (Mumbai), behind access rules on every record. Photos open only through links that expire in minutes.</p>
    <p>Your phone keeps its own copy, so screens open instantly and work with weak signal. It asks the server only for what changed:</p>
    <div class="ab-sync">
      <div><b>Opening</b><span>Shows the saved copy at once, then syncs.</span></div>
      <div><b>Coming back</b><span>Syncs again if you were away 2+ minutes.</span></div>
      <div><b>Pulling down</b><span>Syncs now.</span></div>
      <div><b>Your changes</b><span>Go straight into the copy. Nothing reloads.</span></div>
    </div>
    <p class="ab-note">No signal at a visit? Submit anyway. It waits on the phone and sends itself later.</p>`)}

  ${ch('VII', 'Small things', 'Worth knowing', `
    <ul class="ab-tips">
      <li>Pull down at the top of any tab to sync.</li>
      <li>Swipe left or right to move between sections.</li>
      <li>Pull a panel down to close it.</li>
      <li>Back steps back, then returns to the first tab, then asks before closing.</li>
      <li>Signing out removes your copy from this phone.</li>
    </ul>`)}

  <footer class="ab-foot"><img src="cbi-emblem.png" alt=""><div>TASC Connect · version ${APP_VERSION}<br>Built by Nitin Kotwar (139535), via PDUDAIRO</div></footer>
  </article>`;
}

function openAbout() {
  const body = openSheet('About', aboutHTML());
  const sh = body.closest('.sheet'); if (sh) sh.classList.add('tall');
}
document.addEventListener('click', e => { if (e.target.closest('[data-about]')) openAbout(); });
