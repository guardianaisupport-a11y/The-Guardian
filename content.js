let analyzeButton = null;
let hateSpeechButton = null;
let hideButtonTimer = null;

let piiDebounceTimer = null;
let lastAnalyzedComposerText = '';
let composerObserverStarted = false;
let lastComposerElementForPii = null;

let piiPopup = null;
let piiPopupAnchor = null;
let piiPopupTextKey = '';
let piiPopupDismissedForKey = '';
let piiPopupRepositionRaf = null;
let piiTeaserEl = null;
let lastPiiComposerEl = null;

let hateMonitoringEnabled = false;
let hateObserver = null;
let hateScanTimer = null;

const scannedTextCache = new Map();
const flaggedElements = new WeakSet();

const HATE_SCAN_INTERVAL_MS = 1800;
const TEXT_CACHE_TTL_MS = 30000;

/* -----------------------------------
   UTILITIES
----------------------------------- */

function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function isFacebookSite() {
    return location.hostname.includes('facebook.com') || location.hostname.includes('web.facebook.com');
}

function isXSite() {
    return location.hostname.includes('x.com') || location.hostname.includes('twitter.com');
}

function cleanupOldCache() {
    const now = Date.now();
    for (const [key, value] of scannedTextCache.entries()) {
        if (!value || now - value.ts > TEXT_CACHE_TTL_MS) {
            scannedTextCache.delete(key);
        }
    }
}

/* -----------------------------------
   HIGHLIGHTED TEXT -> ANALYZE BUTTON
----------------------------------- */

function createAnalyzeButton() {
    if (analyzeButton) return analyzeButton;

    analyzeButton = document.createElement('button');
    analyzeButton.id = 'guardian-analyze-btn';
    analyzeButton.type = 'button';
    analyzeButton.className = 'guardian-analyze-btn';
    analyzeButton.setAttribute('aria-label', 'Analyse with Guardian');

    const logo = document.createElement('img');
    logo.className = 'guardian-analyze-btn__logo';
    logo.alt = '';
    logo.src = chrome.runtime.getURL('icons/logov.jpeg');
    logo.decoding = 'async';

    analyzeButton.appendChild(logo);

    analyzeButton.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    analyzeButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const selectedText = window.getSelection()?.toString().trim();
        if (!selectedText) {
            hideAnalyzeButton();
            return;
        }

        const logoEl = analyzeButton.querySelector('.guardian-analyze-btn__logo');

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'openChatWithText',
                text: selectedText,
                pageUrl: location.href
            });

            if (!response?.success) {
                console.error('Failed to open popup with selected text:', response?.error);
            }

            if (logoEl) {
                logoEl.style.opacity = '0.55';
            }

            setTimeout(() => {
                if (analyzeButton) {
                    if (logoEl) {
                        logoEl.style.opacity = '';
                    }
                    hideAnalyzeButton();
                }
            }, 650);
        } catch (error) {
            console.error('Failed to send selected text:', error);
            if (logoEl) {
                logoEl.style.opacity = '';
            }
            hideAnalyzeButton();
        }
    });

    document.documentElement.appendChild(analyzeButton);
    return analyzeButton;
}

function createHateSpeechButton() {
    if (hateSpeechButton) return hateSpeechButton;

    hateSpeechButton = document.createElement('button');
    hateSpeechButton.id = 'guardian-hate-btn';
    hateSpeechButton.type = 'button';
    hateSpeechButton.className = 'guardian-hate-btn';
    hateSpeechButton.setAttribute('aria-label', 'Open hate speech tools with selected text');

    const logo = document.createElement('img');
    logo.className = 'guardian-hate-btn__logo';
    logo.alt = '';
    logo.src = chrome.runtime.getURL('icons/logov.jpeg');
    logo.decoding = 'async';

    hateSpeechButton.appendChild(logo);

    hateSpeechButton.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    hateSpeechButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const selectedText = window.getSelection()?.toString().trim();
        if (!selectedText) {
            hideAnalyzeButton();
            hideHateSpeechButton();
            return;
        }

        const logoEl = hateSpeechButton.querySelector('.guardian-hate-btn__logo');

        try {
            await chrome.storage.local.set({
                pendingSelectedText: selectedText,
                pendingSelectedTextUrl: location.href,
                pendingSelectedTextTs: Date.now()
            });

            const response = await chrome.runtime.sendMessage({
                action: 'openHateSpeechToolsWindow'
            });

            if (!response?.success) {
                console.error('Failed to open hate speech tools window:', response?.error);
            }

            if (logoEl) {
                logoEl.style.opacity = '0.6';
            }

            setTimeout(() => {
                if (hateSpeechButton) {
                    if (logoEl) logoEl.style.opacity = '';
                    hideAnalyzeButton();
                    hideHateSpeechButton();
                }
            }, 650);
        } catch (error) {
            console.error('Failed to open hate speech tools with selected text:', error);
            if (logoEl) logoEl.style.opacity = '';
            hideAnalyzeButton();
            hideHateSpeechButton();
        }
    });

    document.documentElement.appendChild(hateSpeechButton);
    return hateSpeechButton;
}

function showAnalyzeButton(x, y) {
    const btn = createAnalyzeButton();
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
    btn.style.display = 'flex';

    clearTimeout(hideButtonTimer);
    hideButtonTimer = setTimeout(() => {
        hideAnalyzeButton();
    }, 4000);
}

function showHateSpeechButton(x, y) {
    const btn = createHateSpeechButton();
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
    btn.style.display = 'flex';

    clearTimeout(hideButtonTimer);
    hideButtonTimer = setTimeout(() => {
        hideAnalyzeButton();
        hideHateSpeechButton();
    }, 4000);
}

function hideAnalyzeButton() {
    if (analyzeButton) {
        analyzeButton.style.display = 'none';
    }
}

function hideHateSpeechButton() {
    if (hateSpeechButton) {
        hateSpeechButton.style.display = 'none';
    }
}

function handleTextSelection() {
    const selectedText = window.getSelection()?.toString().trim();
    if (!selectedText || selectedText.length < 5) {
        hideAnalyzeButton();
        hideHateSpeechButton();
        return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    const xRight = window.scrollX + rect.right + 8;
    const xLeft = window.scrollX + rect.left - 8;
    const y = window.scrollY + rect.top - 6;

    showAnalyzeButton(xRight, y);
    showHateSpeechButton(xLeft, y);
}

document.addEventListener('mouseup', () => {
    setTimeout(handleTextSelection, 50);
});

document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift' || e.key.startsWith('Arrow')) {
        setTimeout(handleTextSelection, 50);
    }
});

document.addEventListener('mousedown', (e) => {
    if (!analyzeButton) return;
    if (e.target === analyzeButton) return;
    if (e.target === hateSpeechButton) return;

    const selectedText = window.getSelection()?.toString().trim();
    if (!selectedText) {
        hideAnalyzeButton();
        hideHateSpeechButton();
    }
});

/* -----------------------------------
   COMPOSER DETECTION
----------------------------------- */

function getXComposerElement() {
    return document.querySelector(
        'div[data-testid="tweetTextarea_0"], div[role="textbox"][data-testid="tweetTextarea_0"]'
    );
}

function getFacebookComposerElement() {
    const active = document.activeElement;

    if (active instanceof HTMLElement) {
        const closestTextbox = active.closest('div[role="textbox"][contenteditable="true"]');
        if (closestTextbox) return closestTextbox;
    }

    const dialogTextbox = document.querySelector(
        'div[role="dialog"] div[role="textbox"][contenteditable="true"]'
    );
    if (dialogTextbox) return dialogTextbox;

    const genericTextbox = document.querySelector(
        'div[role="textbox"][contenteditable="true"]'
    );
    if (genericTextbox) return genericTextbox;

    return null;
}

function getActiveComposerElement() {
    if (isXSite()) return getXComposerElement();
    if (isFacebookSite()) return getFacebookComposerElement();
    return null;
}

function getComposerTextFromElement(element) {
    if (!element) return '';
    return normalizeText(element.innerText || element.textContent || '');
}

function shouldAnalyzeComposerText(text) {
    return !!text && text.trim().length >= 4;
}

/* -----------------------------------
   PII / OPSEC — INLINE TEASER + DETAIL PANEL
----------------------------------- */

function clearComposerPiiHighlight() {
    if (lastPiiComposerEl && lastPiiComposerEl.isConnected) {
        lastPiiComposerEl.classList.remove('guardian-composer--pii-risk');
        lastPiiComposerEl.removeAttribute('data-pii-level');
    }
    lastPiiComposerEl = null;
}

function setFabPiiState(riskLevel) {
    const main = document.getElementById('guardian-fab-main');
    if (!main) return;
    main.classList.remove('guardian-fab-main--pii-medium', 'guardian-fab-main--pii-high');
    const level = String(riskLevel || '').toLowerCase();
    if (level === 'high') {
        main.classList.add('guardian-fab-main--pii-high');
    } else if (level === 'medium') {
        main.classList.add('guardian-fab-main--pii-medium');
    }
}

function ensurePiiTeaserBubble() {
    if (piiTeaserEl && piiTeaserEl.isConnected) return piiTeaserEl;

    const el = document.createElement('div');
    el.id = 'guardian-pii-teaser';
    el.className = 'guardian-pii-teaser';
    el.setAttribute('data-guardian-ui', 'true');
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.setAttribute('aria-label', 'Privacy warning. Click for full analysis.');

    const msg = document.createElement('div');
    msg.className = 'guardian-pii-teaser__text';
    msg.textContent = "Hmm… you're doing something wrong.";

    const hint = document.createElement('div');
    hint.className = 'guardian-pii-teaser__hint';
    hint.textContent = 'Tap for full analysis';

    el.appendChild(msg);
    el.appendChild(hint);

    el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (piiPopup && piiPopup.dataset.visible === 'true') {
            closePiiDetailPanel();
            return;
        }
        openPiiDetailFromTeaser();
    });
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (piiPopup && piiPopup.dataset.visible === 'true') {
                closePiiDetailPanel();
            } else {
                openPiiDetailFromTeaser();
            }
        }
    });

    piiTeaserEl = el;
    return el;
}

function setPiiTeaserCopy(teaser, riskLevel) {
    const level = String(riskLevel || 'medium').toLowerCase() === 'high' ? 'high' : 'medium';

    const legacyPill = teaser.querySelector('#guardian-pii-teaser-risk');
    if (legacyPill) {
        legacyPill.remove();
    }

    const msgEl = teaser.querySelector('.guardian-pii-teaser__text');
    const hintEl = teaser.querySelector('.guardian-pii-teaser__hint');
    if (msgEl) {
        msgEl.textContent = "Hmm… you're doing something wrong.";
    }
    if (hintEl) {
        hintEl.textContent =
            level === 'high'
                ? 'High risk — Tap for full analysis.'
                : 'Moderate risk — Tap for full analysis.';
    }
}

function mountPiiTeaser(teaser) {
    const fabRoot = document.getElementById('guardian-fab-root');
    const mainBtn = document.getElementById('guardian-fab-main');
    if (fabRoot && mainBtn && mainBtn.parentNode === fabRoot) {
        if (teaser.parentNode !== fabRoot) {
            fabRoot.insertBefore(teaser, mainBtn);
        }
        teaser.classList.remove('guardian-pii-teaser--floating');
    } else if (!teaser.parentNode) {
        document.documentElement.appendChild(teaser);
        teaser.classList.add('guardian-pii-teaser--floating');
    }
}

function tryRelocatePiiTeaserIntoFab() {
    const teaser = document.getElementById('guardian-pii-teaser');
    if (!teaser || teaser.style.display === 'none') return;
    mountPiiTeaser(teaser);
}

function positionPiiDetailNearFab() {
    if (!piiPopup || piiPopup.dataset.visible !== 'true') return;

    const teaser = document.getElementById('guardian-pii-teaser');
    const gap = 10;
    piiPopup.style.position = 'fixed';
    piiPopup.style.left = 'auto';
    piiPopup.style.top = 'auto';

    if (teaser && teaser.style.display !== 'none' && teaser.getBoundingClientRect().height > 0) {
        const tr = teaser.getBoundingClientRect();
        piiPopup.style.right = `${Math.max(12, window.innerWidth - tr.right)}px`;
        piiPopup.style.bottom = `${window.innerHeight - tr.top + gap}px`;
    } else {
        piiPopup.style.right = '16px';
        piiPopup.style.bottom = '120px';
    }

    const maxH = Math.min(480, window.innerHeight - 48);
    piiPopup.style.maxHeight = `${maxH}px`;
    piiPopup.style.overflowY = 'auto';
}

function openPiiDetailFromTeaser() {
    ensurePiiPopup();
    piiPopup.dataset.visible = 'true';
    positionPiiDetailNearFab();
}

function closePiiDetailPanel() {
    if (!piiPopup) return;
    piiPopup.dataset.visible = 'false';
}

function resetPiiPageUi() {
    clearComposerPiiHighlight();
    setFabPiiState(null);
    const teaser = document.getElementById('guardian-pii-teaser');
    if (teaser) {
        teaser.style.display = 'none';
    }
    closePiiDetailPanel();
    piiPopupAnchor = null;
}

function makePiiTextKey(text) {
    const normalized = normalizeText(text);
    return normalized.slice(0, 500);
}

function ensurePiiPopup() {
    if (piiPopup) return piiPopup;

    piiPopup = document.createElement('div');
    piiPopup.id = 'guardian-pii-popup';
    piiPopup.className = 'guardian-pii-popup';
    piiPopup.dataset.visible = 'false';

    const header = document.createElement('div');
    header.className = 'guardian-pii-popup__header';

    const title = document.createElement('div');
    title.className = 'guardian-pii-popup__title';
    title.textContent = '🛡️ PII / OpSec Alert';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'guardian-pii-popup__close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
        closePiiDetailPanel();
    });

    header.appendChild(title);
    header.appendChild(closeBtn);

    const riskPill = document.createElement('div');
    riskPill.className = 'guardian-pii-popup__risk';
    riskPill.id = 'guardian-pii-popup-risk';

    const section1 = document.createElement('div');
    section1.className = 'guardian-pii-popup__section';
    section1.id = 'guardian-pii-popup-summary';

    const reasonsLabel = document.createElement('div');
    reasonsLabel.className = 'guardian-pii-popup__label';
    reasonsLabel.id = 'guardian-pii-popup-reasons-label';
    reasonsLabel.textContent = 'Key reasons:';

    const reasonsList = document.createElement('ul');
    reasonsList.className = 'guardian-pii-popup__reasons';
    reasonsList.id = 'guardian-pii-popup-reasons';

    const adviceLabel = document.createElement('div');
    adviceLabel.className = 'guardian-pii-popup__label';
    adviceLabel.id = 'guardian-pii-popup-advice-label';
    adviceLabel.textContent = 'To stay on the safer side:';

    const advice = document.createElement('div');
    advice.className = 'guardian-pii-popup__section';
    advice.id = 'guardian-pii-popup-advice';

    const suggestionLabel = document.createElement('div');
    suggestionLabel.className = 'guardian-pii-popup__label';
    suggestionLabel.id = 'guardian-pii-popup-suggestion-label';
    suggestionLabel.textContent = 'Suggested safer version:';

    const suggestion = document.createElement('pre');
    suggestion.className = 'guardian-pii-popup__suggestion';
    suggestion.id = 'guardian-pii-popup-suggestion';

    const actions = document.createElement('div');
    actions.className = 'guardian-pii-popup__actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'guardian-pii-popup__btn guardian-pii-popup__btn--primary';
    copyBtn.id = 'guardian-pii-popup-copy';
    copyBtn.textContent = 'Copy suggestion';
    copyBtn.title = 'Copy suggested safer text to clipboard';
    copyBtn.addEventListener('click', async () => {
        try {
            const suggestionText = String(
                document.getElementById('guardian-pii-popup-suggestion')?.textContent || ''
            ).trim();
            if (!suggestionText) return;
            await navigator.clipboard.writeText(suggestionText);
            copyBtn.textContent = 'Copied';
            setTimeout(() => {
                copyBtn.textContent = 'Copy suggestion';
            }, 900);
        } catch (e) {
            // ignore clipboard errors (some pages block it)
        }
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'guardian-pii-popup__btn';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
        piiPopupDismissedForKey = piiPopupTextKey;
        resetPiiPageUi();
    });

    actions.appendChild(dismissBtn);
    actions.appendChild(copyBtn);

    piiPopup.appendChild(header);
    piiPopup.appendChild(riskPill);
    piiPopup.appendChild(section1);
    piiPopup.appendChild(reasonsLabel);
    piiPopup.appendChild(reasonsList);
    piiPopup.appendChild(adviceLabel);
    piiPopup.appendChild(advice);
    piiPopup.appendChild(suggestionLabel);
    piiPopup.appendChild(suggestion);
    piiPopup.appendChild(actions);

    document.documentElement.appendChild(piiPopup);

    window.addEventListener('scroll', () => schedulePiiPopupReposition(), true);
    window.addEventListener('resize', () => schedulePiiPopupReposition(), true);

    return piiPopup;
}

function schedulePiiPopupReposition() {
    if (!piiPopup || piiPopup.dataset.visible !== 'true') return;
    if (piiPopupRepositionRaf) cancelAnimationFrame(piiPopupRepositionRaf);
    piiPopupRepositionRaf = requestAnimationFrame(() => {
        piiPopupRepositionRaf = null;
        positionPiiDetailNearFab();
    });
}

function hidePiiPopup() {
    resetPiiPageUi();
}

function renderPiiPopup(result) {
    const popup = ensurePiiPopup();

    const riskLevelRaw = result?.risk_level || 'low';
    const riskLevel = String(riskLevelRaw).toLowerCase();

    const readableRisk =
        riskLevel === 'high'
            ? 'HIGH'
            : riskLevel === 'medium'
                ? 'MODERATE'
                : 'LOW';

    const riskEl = popup.querySelector('#guardian-pii-popup-risk');
    if (riskEl) {
        riskEl.dataset.level = riskLevel === 'high' ? 'high' : 'medium';
        riskEl.textContent = `${readableRisk} risk`;
    }

    const summaryExplanation = String(result?.summary_explanation || result?.ui_message?.summary || '').trim();
    const advice = String(result?.advice || result?.ui_message?.advice || '').trim();
    const safeRewrite = String(result?.safe_rewrite || '').trim();

    const summaryEl = popup.querySelector('#guardian-pii-popup-summary');
    if (summaryEl) {
        summaryEl.textContent =
            summaryExplanation ||
            'This draft contains personal or safety-related details that could be misused.';
    }

    const reasonsList = popup.querySelector('#guardian-pii-popup-reasons');
    const reasonsLabel = popup.querySelector('#guardian-pii-popup-reasons-label');

    const findings = Array.isArray(result?.findings) ? result.findings : [];
    const reasonItems = findings
        .map((item) => String(item?.explanation || '').trim())
        .filter(Boolean)
        .slice(0, 3);

    if (reasonsList) {
        reasonsList.innerHTML = '';
        if (reasonItems.length > 0) {
            if (reasonsLabel) reasonsLabel.style.display = 'block';
            reasonsList.style.display = 'block';
            reasonItems.forEach((reason) => {
                const li = document.createElement('li');
                li.textContent = reason;
                reasonsList.appendChild(li);
            });
        } else {
            if (reasonsLabel) reasonsLabel.style.display = 'none';
            reasonsList.style.display = 'none';
        }
    }

    const adviceEl = popup.querySelector('#guardian-pii-popup-advice');
    if (adviceEl) {
        adviceEl.textContent =
            advice || 'Review the post before sharing and remove exact personal details where possible.';
    }

    const suggestionLabel = popup.querySelector('#guardian-pii-popup-suggestion-label');
    const suggestionEl = popup.querySelector('#guardian-pii-popup-suggestion');
    const copyBtn = popup.querySelector('#guardian-pii-popup-copy');

    if (safeRewrite && suggestionEl) {
        if (suggestionLabel) suggestionLabel.style.display = 'block';
        suggestionEl.style.display = 'block';
        if (copyBtn) copyBtn.disabled = false;
        suggestionEl.textContent = safeRewrite;
    } else if (suggestionEl) {
        if (suggestionLabel) suggestionLabel.style.display = 'none';
        suggestionEl.style.display = 'none';
        if (copyBtn) copyBtn.disabled = true;
        suggestionEl.textContent = '';
    }
}

function showPiiPopupNearComposer(composer, result, sourceText) {
    const riskLevel = String(result?.risk_level || 'low').toLowerCase();
    if (riskLevel === 'low' || riskLevel === 'none') {
        resetPiiPageUi();
        return;
    }

    piiPopupTextKey = makePiiTextKey(sourceText);
    if (piiPopupTextKey && piiPopupDismissedForKey && piiPopupTextKey === piiPopupDismissedForKey) {
        return;
    }

    clearComposerPiiHighlight();
    const activeComposer = composer instanceof HTMLElement ? composer : getActiveComposerElement();
    if (activeComposer instanceof HTMLElement) {
        lastPiiComposerEl = activeComposer;
        const lvl = riskLevel === 'high' ? 'high' : 'medium';
        activeComposer.classList.add('guardian-composer--pii-risk');
        activeComposer.setAttribute('data-pii-level', lvl);
    }

    piiPopupAnchor = activeComposer;
    renderPiiPopup(result);

    closePiiDetailPanel();

    const teaser = ensurePiiTeaserBubble();
    teaser.dataset.risk = riskLevel === 'high' ? 'high' : 'medium';
    setPiiTeaserCopy(teaser, riskLevel);
    const ariaRisk = riskLevel === 'high' ? 'High risk' : 'Moderate risk';
    teaser.setAttribute(
        'aria-label',
        `Privacy warning: ${ariaRisk}. Tap for full analysis.`
    );
    teaser.style.display = 'flex';
    mountPiiTeaser(teaser);
    setFabPiiState(riskLevel);
}

/* -----------------------------------
   PII / OPSEC ANALYSIS FLOW
----------------------------------- */

async function clearPiiResult() {
    try {
        hidePiiPopup();
        await chrome.runtime.sendMessage({
            action: 'clearPiiOpsecResult'
        });
    } catch (error) {
        console.error('Failed to clear PII result:', error);
    }
}

async function sendComposerTextForAnalysis(text, composer) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'analyzePiiOpsecText',
            text
        });

        if (!response?.success) {
            console.error('PII/OpSec analysis failed:', response?.error);
            hidePiiPopup();
            return;
        }

        if (response?.result) {
            showPiiPopupNearComposer(composer, response.result, text);
        } else {
            hidePiiPopup();
        }
    } catch (error) {
        console.error('Failed to analyze composer text:', error);
        hidePiiPopup();
    }
}

function scheduleComposerAnalysis(text, composer) {
    clearTimeout(piiDebounceTimer);

    piiDebounceTimer = setTimeout(async () => {
        const normalized = text.trim();

        if (!shouldAnalyzeComposerText(normalized)) {
            lastAnalyzedComposerText = '';
            await clearPiiResult();
            return;
        }

        if (normalized === lastAnalyzedComposerText) {
            return;
        }

        lastAnalyzedComposerText = normalized;
        await sendComposerTextForAnalysis(normalized, composer);
    }, 900);
}

function extractRelevantComposerFromEventTarget(target) {
    if (!(target instanceof HTMLElement)) return null;

    if (isXSite()) {
        return target.closest('div[role="textbox"]');
    }

    if (isFacebookSite()) {
        return target.closest('div[role="textbox"][contenteditable="true"]');
    }

    return null;
}

function setupLiveComposerWatcher() {
    document.addEventListener('input', (event) => {
        const composer = extractRelevantComposerFromEventTarget(event.target);
        if (!composer) return;

        const text = getComposerTextFromElement(composer);
        lastComposerElementForPii = composer;
        scheduleComposerAnalysis(text, composer);
    }, true);

    document.addEventListener('keyup', () => {
        const composer = getActiveComposerElement();
        if (!composer) return;

        const text = getComposerTextFromElement(composer);
        lastComposerElementForPii = composer;
        scheduleComposerAnalysis(text, composer);
    }, true);

    document.addEventListener('click', () => {
        setTimeout(() => {
            const composer = getActiveComposerElement();
            if (!composer) return;

            const text = getComposerTextFromElement(composer);
            if (!text.trim()) {
                clearPiiResult();
                lastAnalyzedComposerText = '';
                lastComposerElementForPii = null;
                hidePiiPopup();
            }
        }, 150);
    }, true);
}

function startComposerObserver() {
    if (composerObserverStarted) return;
    composerObserverStarted = true;

    if (!isXSite() && !isFacebookSite()) return;

    setupLiveComposerWatcher();

    const observer = new MutationObserver(() => {
        const composer = getActiveComposerElement();

        if (!composer) {
            clearPiiResult();
            lastAnalyzedComposerText = '';
            lastComposerElementForPii = null;
            hidePiiPopup();
            return;
        }

        const text = getComposerTextFromElement(composer);
        if (!text.trim()) {
            clearPiiResult();
            lastAnalyzedComposerText = '';
            lastComposerElementForPii = null;
            hidePiiPopup();
            return;
        }

        // If the popup is visible, keep it anchored to the active composer
        if (piiPopup && piiPopup.dataset.visible === 'true') {
            piiPopupAnchor = composer;
            schedulePiiPopupReposition();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

/* -----------------------------------
   HATE SPEECH MONITORING
----------------------------------- */

async function loadMonitoringState() {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'getHateSpeechMonitoring'
        });

        hateMonitoringEnabled = Boolean(response?.enabled);

        if (hateMonitoringEnabled) {
            startHateSpeechMonitoringObserver();
            scheduleHateSpeechScan();
        } else {
            stopHateSpeechMonitoringObserver();
        }
    } catch (error) {
        console.error('Failed to load hate speech monitoring state:', error);
    }
}

function startHateSpeechMonitoringObserver() {
    if (hateObserver || !document.body) return;

    hateObserver = new MutationObserver(() => {
        if (!hateMonitoringEnabled) return;
        scheduleHateSpeechScan();
    });

    hateObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function stopHateSpeechMonitoringObserver() {
    if (hateObserver) {
        hateObserver.disconnect();
        hateObserver = null;
    }

    if (hateScanTimer) {
        clearTimeout(hateScanTimer);
        hateScanTimer = null;
    }
}

function scheduleHateSpeechScan() {
    if (!hateMonitoringEnabled) return;

    if (hateScanTimer) {
        clearTimeout(hateScanTimer);
    }

    hateScanTimer = setTimeout(() => {
        scanVisiblePageForHateSpeech();
    }, HATE_SCAN_INTERVAL_MS);
}

function getCandidateTextElements() {
    const candidates = [];

    if (isXSite()) {
        document.querySelectorAll('[data-testid="tweetText"]').forEach((el) => {
            candidates.push(el);
        });

        document.querySelectorAll('article div[lang]').forEach((el) => {
            candidates.push(el);
        });
    }

    if (isFacebookSite()) {
        document.querySelectorAll('div[role="article"] div[dir="auto"]').forEach((el) => {
            candidates.push(el);
        });

        document.querySelectorAll('div[role="feed"] div[dir="auto"]').forEach((el) => {
            candidates.push(el);
        });
    }

    return [...new Set(candidates)];
}

function shouldSkipElement(el) {
    if (!el || !(el instanceof HTMLElement)) return true;
    if (!isVisible(el)) return true;

    if (el.closest('[data-guardian-ui="true"]')) return true;
    if (el.closest('#guardian-analyze-btn')) return true;
    if (el.closest('[data-guardian-warning="true"]')) return true;

    const text = normalizeText(el.innerText || el.textContent || '');
    if (!text) return true;
    if (text.length < 8) return true;
    if (text.length > 280) return true;

    return false;
}

async function scanVisiblePageForHateSpeech() {
    if (!hateMonitoringEnabled) return;

    cleanupOldCache();

    const elements = getCandidateTextElements();

    for (const el of elements) {
        if (shouldSkipElement(el)) continue;

        const text = normalizeText(el.innerText || el.textContent || '');
        const cached = scannedTextCache.get(text);

        if (cached && (Date.now() - cached.ts) < TEXT_CACHE_TTL_MS) {
            if (cached.flagged && !flaggedElements.has(el)) {
                applyHateSpeechWarning(el, cached.result);
            }
            continue;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'analyzeHateSpeechText',
                text
            });

            if (!response?.success || !response?.result) {
                scannedTextCache.set(text, {
                    ts: Date.now(),
                    flagged: false,
                    result: null
                });
                continue;
            }

            const result = response.result;
            const label = String(result.label || '').toLowerCase();
            const flagged = label === 'hate' || label === 'offensive';

            scannedTextCache.set(text, {
                ts: Date.now(),
                flagged,
                result
            });

            if (flagged) {
                applyHateSpeechWarning(el, result);
            }
        } catch (error) {
            console.error('Failed hate-speech scan for text:', text, error);
        }
    }
}

function applyHateSpeechWarning(targetEl, result) {
    if (!targetEl || flaggedElements.has(targetEl)) return;

    flaggedElements.add(targetEl);

    const label = String(result.label || '').toLowerCase();
    const confidence = Math.round(Number(result.confidence || 0) * 100);

    let borderColor = '#c98b42';
    let badgeBg = '#d09a57';
    let badgeText = 'Offensive language';

    if (label === 'hate') {
        borderColor = '#9b4d3a';
        badgeBg = '#a85b47';
        badgeText = 'Hate speech';
    }

    targetEl.style.outline = `2px solid ${borderColor}`;
    targetEl.style.outlineOffset = '2px';
    targetEl.style.borderRadius = '6px';

    const badge = document.createElement('div');
    badge.setAttribute('data-guardian-warning', 'true');
    badge.textContent = `${badgeText} • ${confidence}%`;
    badge.style.display = 'inline-block';
    badge.style.marginTop = '6px';
    badge.style.padding = '4px 8px';
    badge.style.borderRadius = '6px';
    badge.style.background = badgeBg;
    badge.style.color = '#fff';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = '600';
    badge.style.cursor = 'pointer';
    badge.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';

    badge.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        try {
            await chrome.storage.local.set({
                pendingSelectedText: normalizeText(targetEl.innerText || targetEl.textContent || ''),
                pendingSelectedTextUrl: location.href,
                pendingSelectedTextTs: Date.now()
            });
            await chrome.runtime.sendMessage({ action: 'openHateSpeechToolsWindow' });
        } catch (error) {
            console.error('Failed to open hate speech window from hate badge:', error);
        }
    });

    if (!targetEl.querySelector('[data-guardian-warning="true"]')) {
        targetEl.appendChild(badge);
    }
}

/* -----------------------------------
   STORAGE CHANGE LISTENER
----------------------------------- */

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.hateSpeechMonitoringEnabled) {
        hateMonitoringEnabled = Boolean(changes.hateSpeechMonitoringEnabled.newValue);

        if (hateMonitoringEnabled) {
            startHateSpeechMonitoringObserver();
            scheduleHateSpeechScan();
        } else {
            stopHateSpeechMonitoringObserver();
        }
    }
});

/* -----------------------------------
   START
----------------------------------- */

createAnalyzeButton();
startComposerObserver();
loadMonitoringState();

/* -----------------------------------
   FLOATING GUARDIAN — UNDERCOVER QUICK ACTIONS
----------------------------------- */

function initGuardianFab() {
    if (document.getElementById('guardian-fab-root')) return;

    const root = document.createElement('div');
    root.id = 'guardian-fab-root';
    root.className = 'guardian-fab-root';
    root.setAttribute('data-guardian-ui', 'true');

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'guardian-fab-main';
    mainBtn.id = 'guardian-fab-main';
    mainBtn.setAttribute('aria-label', 'Open hate speech tools');
    mainBtn.textContent = 'G';

    mainBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            await chrome.runtime.sendMessage({
                action: 'guardianFabQuickAction',
                mode: 'hate'
            });
        } catch (err) {
            console.error('[Guardian FAB]', err);
        }
    });

    root.appendChild(mainBtn);
    document.documentElement.appendChild(root);

    tryRelocatePiiTeaserIntoFab();
}

initGuardianFab();

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (piiPopup && piiPopup.dataset.visible === 'true') {
        closePiiDetailPanel();
    }
});

/* -----------------------------------
   SCAM LINK SCANNING
----------------------------------- */

(function() {
    'use strict';

    // Configuration
    const DEBOUNCE_DELAY = 1000;
    let processTimeout = null;
    let scannedLinks = new Set();

    function isSearchEngine() {
        const hostname = window.location.hostname.toLowerCase();
        const searchEngines = ['google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'yandex.com'];
        return searchEngines.some(engine => hostname.includes(engine));
    }

    function isImageOnlyLink(link) {
        const children = Array.from(link.childNodes);
        if (children.length === 1 && children[0].tagName === 'IMG') {
            return true;
        }
        const nonWhitespaceChildren = children.filter(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                return node.textContent.trim().length > 0;
            }
            return node.tagName === 'IMG';
        });
        return nonWhitespaceChildren.length === 1 && nonWhitespaceChildren[0].tagName === 'IMG';
    }

    function unwrapRedirectUrl(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();
            if (hostname === 'l.facebook.com' || hostname.includes('facebook.com')) {
                const uParam = urlObj.searchParams.get('u');
                if (uParam) {
                    try {
                        return decodeURIComponent(uParam);
                    } catch (e) {
                        return uParam;
                    }
                }
            }
            return url;
        } catch (e) {
            return url;
        }
    }

    function extractContextText(link) {
        const maxDepth = 3;
        let element = link;
        let depth = 0;
        let linkText = (link.textContent || link.innerText || '').trim();
        
        if (linkText.length > 50) {
            return linkText.substring(0, 300);
        }
        
        while (element && depth < maxDepth) {
            element = element.parentElement;
            if (!element) break;
            depth++;
            
            const tagName = element.tagName ? element.tagName.toLowerCase() : '';
            const containerTags = ['div', 'p', 'span', 'article', 'section', 'li', 'td', 'th'];
            
            if (containerTags.includes(tagName)) {
                const text = element.cloneNode(true);
                const linkClone = text.querySelector('a');
                if (linkClone) {
                    linkClone.remove();
                }
                
                const contextText = (text.textContent || text.innerText || '').trim();
                
                if (contextText.length > 50) {
                    if (linkText.length < 20) {
                        return (linkText + ' ' + contextText).substring(0, 300);
                    }
                    return contextText.substring(0, 300);
                }
            }
        }
        
        return linkText.substring(0, 300);
    }

    function isUINoiseLink(link) {
        const text = (link.textContent || link.innerText || '').trim().toLowerCase();
        const uiPatterns = [
            'privacy', 'terms', 'settings', 'log in', 'login', 'sign in', 'signin',
            'sign up', 'signup', 'register', 'about', 'contact', 'help', 'support',
            'faq', 'cookie', 'cookies', 'legal', 'copyright', 'home', 'menu',
            'navigation', 'nav', 'more', 'less', 'show more', 'show less', 'read more', 'read less'
        ];
        return uiPatterns.some(pattern => text === pattern || text.includes(pattern));
    }

    function isInUIContainer(link) {
        let element = link;
        const maxDepth = 10;
        let depth = 0;
        
        while (element && depth < maxDepth) {
            if (element.tagName) {
                const tagName = element.tagName.toLowerCase();
                if (tagName === 'nav' || tagName === 'footer' || tagName === 'header') {
                    return true;
                }
                const className = (element.className || '').toLowerCase();
                const id = (element.id || '').toLowerCase();
                if (className.includes('nav') || className.includes('menu') || 
                    id.includes('nav') || id.includes('menu') ||
                    className.includes('footer') || id.includes('footer') ||
                    className.includes('header') || id.includes('header')) {
                    return true;
                }
            }
            element = element.parentElement;
            depth++;
        }
        
        return false;
    }

    function shouldScanLink(link) {
        const href = link.href;
        
        if (!href || href.startsWith('javascript:') || href.startsWith('#') ||
            href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('ftp:')) {
            return false;
        }
        
        let linkHostname = null;
        let realUrl = href;
        try {
            const url = new URL(href);
            linkHostname = url.hostname.toLowerCase();
            realUrl = unwrapRedirectUrl(href);
        } catch (e) {
            return false;
        }
        
        if (scannedLinks.has(realUrl)) {
            return false;
        }
        
        const currentHostname = window.location.hostname.toLowerCase();
        const isSearchEnginePage = isSearchEngine();
        
        if (linkHostname === currentHostname && !isSearchEnginePage) {
            return false;
        }
        
        if (isInUIContainer(link)) {
            return false;
        }
        
        if (isImageOnlyLink(link) && linkHostname === currentHostname) {
            return false;
        }
        
        if (isUINoiseLink(link)) {
            return false;
        }
        
        return true;
    }

    function createBadge(link, initialState = 'loading') {
        if (link.querySelector('.guardian-badge') || link.parentElement?.querySelector('.guardian-badge')) {
            return null;
        }

        const badge = document.createElement('span');
        badge.className = `guardian-badge guardian-badge-${initialState}`;
        
        if (initialState === 'loading') {
            badge.textContent = 'Scanning...';
        } else if (initialState === 'suspicious') {
            badge.textContent = '⚠️ SUSPICIOUS';
        } else if (initialState === 'danger') {
            badge.textContent = '⚠️ SUSPICIOUS';
        } else if (initialState === 'error') {
            badge.textContent = 'Error';
        }

        const computedStyle = window.getComputedStyle(link);
        const isBlock = computedStyle.display === 'block' || 
                       computedStyle.display === 'flex' || 
                       computedStyle.display === 'grid';
        const hasCardStructure = link.querySelector('img, video, [class*="card"], [class*="preview"]');
        
        if (isBlock || hasCardStructure) {
            const textContainer = link.querySelector('p, span, div[class*="text"], div[class*="content"]');
            if (textContainer) {
                if (textContainer.parentNode) {
                    textContainer.parentNode.insertBefore(badge, textContainer.nextSibling);
                } else {
                    textContainer.appendChild(badge);
                }
            } else {
                if (link.firstChild) {
                    link.insertBefore(badge, link.firstChild);
                } else {
                    link.appendChild(badge);
                }
            }
        } else {
            if (link.parentNode) {
                link.parentNode.insertBefore(badge, link.nextSibling);
            } else {
                link.appendChild(badge);
            }
        }

        return badge;
    }

    function updateBadge(badge, result) {
        if (!badge) return;

        badge.classList.remove(
            'guardian-badge-loading',
            'guardian-badge-safe',
            'guardian-badge-suspicious',
            'guardian-badge-danger',
            'guardian-badge-error'
        );

        if (result && result.error) {
            badge.style.display = 'none';
            return;
        } else if (result) {
            const riskScore = result.risk_score || 0;

            if (riskScore >= 80) {
                badge.style.display = 'inline-flex';
                badge.classList.add('guardian-badge-danger');
                badge.textContent = '⚠️ SUSPICIOUS';
            } else if (riskScore >= 30) {
                badge.style.display = 'inline-flex';
                badge.classList.add('guardian-badge-suspicious');
                badge.textContent = '⚠️ SUSPICIOUS';
            } else {
                badge.style.display = 'none';
            }
        } else {
            badge.style.display = 'none';
        }
    }

    function scanLink(link) {
        const originalHref = link.href;
        const realUrl = unwrapRedirectUrl(originalHref);
        const trackingUrl = realUrl !== originalHref ? realUrl : originalHref;
        
        scannedLinks.add(trackingUrl);
        
        const badge = createBadge(link, 'loading');
        if (!badge) return;

        const contextText = extractContextText(link);

        chrome.runtime.sendMessage({
            action: 'SCAN_URL',
            url: realUrl,
            text: contextText
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[Guardian] Runtime error:', chrome.runtime.lastError);
                updateBadge(badge, { error: true });
                return;
            }

            if (response && response.error) {
                updateBadge(badge, { error: true });
            } else if (response) {
                updateBadge(badge, response);
                
                const riskScore = response.risk_score || 0;
                if (riskScore >= 30) {
                    badge.addEventListener('click', (e) => {
                        const target = e.target;
                        if (target.classList.contains('guardian-badge-danger') || 
                            target.classList.contains('guardian-badge-suspicious')) {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            chrome.runtime.sendMessage({
                                action: 'OPEN_SAFE_PREVIEW',
                                url: realUrl,
                                scanData: {
                                    risk_score: riskScore,
                                    status: response.status || 'suspicious',
                                    explanation: response.explanation || '',
                                    url_result: response.url_result || null,
                                    text_result: response.text_result || null,
                                    confidence: response.text_result?.confidence || response.confidence || 0,
                                    source: response.source || 'hybrid'
                                }
                            }, (previewResponse) => {
                                if (chrome.runtime.lastError) {
                                    console.error('[Guardian] Safe Preview open error:', chrome.runtime.lastError);
                                }
                            });
                        }
                    });
                }
            } else {
                updateBadge(badge, { error: true });
            }
        });
    }

    function processLinks() {
        const links = document.querySelectorAll('a:not([data-guardian-scanned])');
        
        let processedCount = 0;
        
        links.forEach(link => {
            if (shouldScanLink(link)) {
                link.setAttribute('data-guardian-scanned', 'true');
                scanLink(link);
                processedCount++;
            } else {
                link.setAttribute('data-guardian-scanned', 'true');
            }
        });
        
        if (processedCount > 0) {
            console.log(`[Guardian] Processed ${processedCount} new links`);
        }
    }

    function debouncedProcessLinks() {
        if (processTimeout) {
            clearTimeout(processTimeout);
        }
        
        processTimeout = setTimeout(() => {
            processLinks();
        }, DEBOUNCE_DELAY);
    }

    function init() {
        processLinks();

        const observer = new MutationObserver((mutations) => {
            let shouldProcess = false;
            
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.tagName === 'A' || node.querySelector('a')) {
                                shouldProcess = true;
                            }
                        }
                    });
                }
            });
            
            if (shouldProcess) {
                debouncedProcessLinks();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                scannedLinks.clear();
                processLinks();
            }
        });

        urlObserver.observe(document, {
            subtree: true,
            childList: true
        });

        console.log('[Guardian] Link scanning initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
