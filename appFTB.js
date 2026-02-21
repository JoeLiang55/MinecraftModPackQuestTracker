/*
  Shared FTB Quests tracker scaffold for packs like SkyFactory 4 and All the Mods 10.
  NOTE: This is a placeholder implementation. It wires up the UI and
  clearly explains what files the user/host needs to provide.

  Future work: parse FTB Quests exported data (quest definitions + player progress)
  and render chapters/quests similar to BetterQuesting-based trackers.
*/

(function () {
  // Detect basic DOM structure
  const playerFileInput = document.getElementById('playerFile');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const questList = document.getElementById('questList');
  const chapterNav = document.getElementById('chapterNav');

  // Optional elements (may not exist on all FTB pages yet)
  const infoBanner = document.getElementById('ftbInfoBanner');

  // Identify pack from a data attribute set in the HTML
  const packId = document.body.getAttribute('data-pack-id') || 'ftb-pack';
  const packName = document.body.getAttribute('data-pack-name') || 'FTB Quests Pack';

  function setBannerMessage(msg) {
    if (!infoBanner) return;
    infoBanner.textContent = msg;
    infoBanner.style.display = 'block';
  }

  function init() {
    if (!playerFileInput || !questList) {
      console.warn('FTB tracker: missing core DOM elements');
      return;
    }

    setBannerMessage(
      'This pack uses FTB Quests. To fully enable this tracker, the site maintainer must add an exported FTB quests file (quest definitions) for ' +
        packName +
        ' to the repository. For now, you can upload your player progress file and we will inspect it only on this page.'
    );

    playerFileInput.addEventListener('change', handlePlayerFile);
  }

  async function handlePlayerFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        console.error('FTB tracker: uploaded file is not valid JSON', err);
        questList.innerHTML = '<p class="placeholder">Uploaded file is not valid JSON. FTB Quests support is not implemented yet for this pack.</p>';
        return;
      }

      console.log('FTB tracker: raw player data for', packId, data);

      // Placeholder behaviour: show a simple summary and explanation
      questList.innerHTML = '';
      const summary = document.createElement('div');
      summary.className = 'placeholder';
      summary.style.maxWidth = '800px';
      summary.style.margin = '40px auto';
      summary.style.lineHeight = '1.6';
      summary.innerHTML = [
        '<strong>FTB Quests support is not fully wired up yet for this pack.</strong>',
        '<br><br>',
        'We successfully loaded your player progress JSON. To turn this into a full quest tracker we need:',
        '<ul style="text-align:left; margin-top:10px;">',
        '<li>An <strong>exported FTB quest definition file</strong> from the modpack (all quests + chapters).</li>',
        '<li>A small mapping layer that matches this pack\'s FTB data format to the site\'s generic quest model.</li>',
        '</ul>',
        '<br>',
        'Once those are added for <strong>' +
          packName +
          '</strong>, this page will render chapters and quests similar to the Nomifactory / Enigmatica / GTNH trackers.'
      ].join('');
      questList.appendChild(summary);

      if (progressContainer && progressFill && progressText) {
        progressContainer.style.display = 'flex';
        progressFill.style.width = '0%';
        progressText.textContent = '0%';
      }

      if (chapterNav) {
        chapterNav.innerHTML = '';
      }
    } catch (err) {
      console.error('FTB tracker: error reading file', err);
      questList.innerHTML = '<p class="placeholder">Error reading file. See console for details.</p>';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
