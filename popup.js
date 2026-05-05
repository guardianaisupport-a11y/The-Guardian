const CONFIG = window.GUARDIAN_CONFIG || {
    GATEWAY_BASE_URL: 'http://localhost:8090',
    MISINFORMATION_BASE_URL: 'http://localhost:8090/misinformation'
};
const GATEWAY_BASE_URL = CONFIG.GATEWAY_BASE_URL;
const MISINFORMATION_BASE_URL = CONFIG.MISINFORMATION_BASE_URL;

class ChatInterface {
    constructor() {
        this.chatMessages = document.getElementById('chatMessages');
        this.userInput = document.getElementById('userInput');
        this.sendButton = document.getElementById('sendButton');
        this.openHateSpeechToolsBtn = document.getElementById('openHateSpeechToolsBtn');

        this.misinfoResult = document.getElementById('misinfoResult');
        this.susceptibilityResult = document.getElementById('susceptibilityResult');
        this.responseLevel = document.getElementById('responseLevel');
        this.riskNote = document.querySelector('.risk-note');
        this.subscriptionPlan = document.getElementById('subscriptionPlan');
        this.subscriptionCountdown = document.getElementById('subscriptionCountdown');

        this.actionButtons = document.querySelector('.action-buttons');
        this.questionBtn = document.getElementById('questionBtn');
        this.acceptBtn = document.getElementById('acceptBtn');
        this.rejectBtn = document.getElementById('rejectBtn');

        this.profileModal = document.getElementById('profileModal');
        this.profileSettingsBtn = document.getElementById('profileSettingsBtn');
        this.closeModalBtn = document.querySelector('.close-modal');
        this.saveProfileBtn = document.getElementById('saveProfileBtn');

        this.currentMessage = null;
        this.currentResponse = null;
        this.latestPrivacyResult = null;
        this.subscriptionTimer = null;
        this.subscriptionActive = false;

        this.initializeEventListeners();
        this.boot();
    }

    async boot() {
        this.initializeUI();
        this.loadUserData();
        const enabled = await this.ensureSubscription();
        if (!enabled) {
            this.addSystemMessage('⚠️ Enter a valid subscription code to use Guardian features.');
            return;
        }

        this.loadPendingSelectedText();
        this.loadGuardianFabQuickAction();
        this.checkAIConnection();
        this.loadLatestPrivacyRisk();
        this.listenForPrivacyUpdates();
    }

    initializeUI() {
        if (this.actionButtons) {
            this.actionButtons.style.display = 'none';
        }

        if (this.chatMessages) {
            const hasMessages = this.chatMessages.children.length > 0;
            if (!hasMessages) {
                this.addSystemMessage('🤖 Hey, Guardian is here looking out for you.');
            }
        }

        if (this.userInput) {
            this.autoResizeTextarea();
        }

        this.updateMisinfoStatus('Ready');
        this.setFeatureEnabled(false);
        this.updateSubscriptionStatusUI({
            active: false,
            plan: null,
            remainingMs: 0
        });
    }

    initializeEventListeners() {
        if (this.sendButton) {
            this.sendButton.addEventListener('click', () => this.sendMessage());
        }

        if (this.openHateSpeechToolsBtn) {
            this.openHateSpeechToolsBtn.addEventListener('click', () => this.openHateSpeechWindow());
        }

        if (this.userInput) {
            this.userInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });

            this.userInput.addEventListener('input', () => this.autoResizeTextarea());
        }

        if (this.questionBtn) {
            this.questionBtn.addEventListener('click', () => this.trackUserAction('questioned'));
        }

        if (this.acceptBtn) {
            this.acceptBtn.addEventListener('click', () => this.trackUserAction('accepted'));
        }

        if (this.rejectBtn) {
            this.rejectBtn.addEventListener('click', () => this.trackUserAction('rejected'));
        }

        if (this.profileSettingsBtn && this.profileModal) {
            this.profileSettingsBtn.addEventListener('click', () => {
                this.profileModal.style.display = 'block';
            });
        }

        if (this.closeModalBtn && this.profileModal) {
            this.closeModalBtn.addEventListener('click', () => {
                this.profileModal.style.display = 'none';
            });
        }

        if (this.saveProfileBtn) {
            this.saveProfileBtn.addEventListener('click', () => this.updateProfile());
        }
    }

    autoResizeTextarea() {
        if (!this.userInput) return;
        this.userInput.style.height = 'auto';
        const nextHeight = Math.min(this.userInput.scrollHeight, 120);
        this.userInput.style.height = `${nextHeight}px`;
    }

    async loadPendingSelectedText() {
        try {
            const data = await chrome.storage.local.get([
                'pendingSelectedText',
                'pendingSelectedTextUrl',
                'pendingSelectedTextTs'
            ]);

            const selectedText = (data.pendingSelectedText || '').trim();
            if (!selectedText) return;

            if (this.userInput) {
                this.userInput.value = selectedText;
                this.userInput.focus();
                this.autoResizeTextarea();
            }

            await chrome.storage.local.remove([
                'pendingSelectedText',
                'pendingSelectedTextUrl',
                'pendingSelectedTextTs'
            ]);
        } catch (error) {
            console.error('Error loading pending selected text:', error);
        }
    }

    async loadGuardianFabQuickAction() {
        try {
            const data = await chrome.storage.local.get([
                'guardianFabQuickAction',
                'guardianFabQuickActionTs'
            ]);
            const mode = data.guardianFabQuickAction;
            const ts = Number(data.guardianFabQuickActionTs) || 0;
            if (!mode || Date.now() - ts > 60000) {
                return;
            }

            await chrome.storage.local.remove([
                'guardianFabQuickAction',
                'guardianFabQuickActionTs'
            ]);

            const hints = {
                misinfo:
                    '🕶️ Ghost — Misinformation desk. Paste a claim or ask what to verify.',
                pii:
                    '🕶️ Cipher — Privacy sweep. Paste text below to scan for PII / OpSec exposure.',
                scam:
                    '🕶️ Trace — Link & scam sweep. Watch for Guardian badges on links; tap a warning badge for Safe Preview.'
            };

            if (hints[mode]) {
                this.addSystemMessage(hints[mode]);
            }

            if (mode === 'pii' && this.userInput) {
                this.userInput.placeholder =
                    'Paste text for privacy / OpSec analysis…';
                this.userInput.focus();
            } else if (mode === 'misinfo' && this.userInput) {
                this.userInput.focus();
            }
        } catch (error) {
            console.error('Error loading Guardian FAB action:', error);
        }
    }

    async loadUserData() {
        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'getUserData' }, resolve);
            });

            if (!response || !response.userData) {
                return;
            }

            const userData = response.userData;

            const userNameEl = document.getElementById('userName');
            const riskBadgeEl = document.getElementById('riskBadge');

            if (userNameEl) {
                userNameEl.textContent = userData.name || 'User';
            }

            if (riskBadgeEl) {
                const riskLevel = (userData.riskLevel || 'Medium').toLowerCase();
                riskBadgeEl.textContent = `${userData.riskLevel || 'Medium'} Risk`;
                riskBadgeEl.className = `risk-badge ${riskLevel}`;
            }

            if (this.responseLevel) {
                const riskLevel = (userData.riskLevel || 'medium').toLowerCase();

                const responseLevels = {
                    high: '🔴 Detailed & Educational',
                    medium: '🟡 Moderate Detail',
                    low: '🟢 Standard'
                };

                this.responseLevel.textContent = responseLevels[riskLevel] || 'Adaptive';
            }

            if (this.riskNote) {
                const riskLevel = (userData.riskLevel || 'medium').toLowerCase();

                const riskNotes = {
                    high: 'You\'ll receive detailed warnings and educational content',
                    medium: 'You\'ll receive moderate warnings with source suggestions',
                    low: 'You\'ll receive standard fact-checked responses'
                };

                this.riskNote.textContent = riskNotes[riskLevel] || 'Responses adapt to your risk level';
            }

            if (this.susceptibilityResult) {
                const score = userData.susceptibilityScore;
                const riskLevel = (userData.riskLevel || 'medium').toLowerCase();

                if (score !== null && score !== undefined) {
                    this.susceptibilityResult.textContent = `${score}/100 (${userData.riskLevel || 'Medium'} Risk)`;
                    this.susceptibilityResult.className = `risk-${riskLevel}`;
                } else {
                    this.susceptibilityResult.textContent = '--';
                    this.susceptibilityResult.className = '';
                }
            }

            const updateAgeGroup = document.getElementById('updateAgeGroup');
            const updateEducation = document.getElementById('updateEducation');
            const educationLevel = document.getElementById('educationLevel');

            if (updateAgeGroup && userData.ageGroup) {
                updateAgeGroup.value = userData.ageGroup;
            }

            if (updateEducation && userData.educationLevel) {
                updateEducation.value = userData.educationLevel;
            }

            if (educationLevel && userData.educationLevel) {
                educationLevel.value = userData.educationLevel;
            }

            const susceptibilityScore = document.getElementById('susceptibilityScore');
            const riskLevelDisplay = document.getElementById('riskLevelDisplay');
            const scoreFill = document.getElementById('scoreFill');

            if (susceptibilityScore) {
                susceptibilityScore.textContent = userData.susceptibilityScore ?? 0;
            }

            if (riskLevelDisplay) {
                riskLevelDisplay.textContent = `Risk Level: ${userData.riskLevel || 'Unknown'}`;
            }

            if (scoreFill) {
                const score = Number(userData.susceptibilityScore || 0);
                scoreFill.style.width = `${score}%`;

                if (score < 30) {
                    scoreFill.style.backgroundColor = '#4caf50';
                } else if (score < 70) {
                    scoreFill.style.backgroundColor = '#ff9800';
                } else {
                    scoreFill.style.backgroundColor = '#f44336';
                }
            }

        } catch (error) {
            console.error('Error loading user data:', error);
        }
    }

    async updateProfile() {
        try {
            const updateAgeGroup = document.getElementById('updateAgeGroup');
            const updateEducation = document.getElementById('updateEducation');
            const educationLevel = document.getElementById('educationLevel');

            const updates = {};

            if (updateAgeGroup && updateAgeGroup.value) {
                updates.ageGroup = updateAgeGroup.value;
            }

            if (updateEducation && updateEducation.value) {
                updates.educationLevel = updateEducation.value;
            } else if (educationLevel && educationLevel.value) {
                updates.educationLevel = educationLevel.value;
            }

            if (Object.keys(updates).length === 0) {
                this.addSystemMessage('⚠️ No profile changes detected.');
                return;
            }

            await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    action: 'updateUserData',
                    updates
                }, resolve);
            });

            await this.loadUserData();

            if (this.profileModal) {
                this.profileModal.style.display = 'none';
            }

            this.addSystemMessage('✅ Profile updated successfully!');
        } catch (error) {
            console.error('Error updating profile:', error);
            this.addSystemMessage('❌ Error updating profile.');
        }
    }

    async checkAIConnection() {
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ action: 'checkAIConnection' }, (resp) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(resp);
                    }
                });
            });

            if (response && response.connected) {
                this.addSystemMessage(`✅ Misinformation API connected via gateway (${GATEWAY_BASE_URL}) — full chat features available.`);
            } else {
                this.addSystemMessage(`⚠️ Misinformation API offline — chat uses limited fallbacks. Start guardian-gateway (docker-compose) and ensure GET ${MISINFORMATION_BASE_URL}/api/health works.`);
            }
        } catch (error) {
            console.error('AI connection check failed:', error);
            this.addSystemMessage(`⚠️ Could not verify connection to the misinformation service via gateway (${GATEWAY_BASE_URL}).`);
        }

        let lastStatus = null;

        chrome.runtime.onMessage.addListener((request) => {
            if (request.action === 'connectionStatusChanged') {
                const currentStatus = `${request.connected}-${request.aiReady}`;
                if (currentStatus === lastStatus) return;
                lastStatus = currentStatus;

                if (request.connected) {
                    this.addSystemMessage(`✅ Misinformation API connected via gateway (${GATEWAY_BASE_URL}).`);
                } else {
                    this.addSystemMessage(`⚠️ Misinformation API disconnected — check gateway docker-compose (${GATEWAY_BASE_URL}).`);
                }
            }
        });
    }

    openHateSpeechWindow() {
        try {
            chrome.windows.create({
                url: chrome.runtime.getURL('hatespeech.html'),
                type: 'popup',
                width: 456,
                height: 668,
                focused: true
            });
        } catch (error) {
            console.error('Failed to open hate speech window:', error);
            this.addSystemMessage('❌ Could not open hate speech tools.');
        }
    }

    async loadLatestPrivacyRisk() {
        try {
            const data = await chrome.storage.local.get(['latestPiiOpsecResult', 'piiRisk']);
            this.latestPrivacyResult = data.latestPiiOpsecResult || data.piiRisk || null;
            this.renderPrivacyRiskBubbles();
        } catch (error) {
            console.error('Error loading privacy result:', error);
            this.latestPrivacyResult = null;
            this.renderPrivacyRiskBubbles();
        }
    }

    listenForPrivacyUpdates() {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;

            if (changes.latestPiiOpsecResult || changes.piiRisk) {
                const latest = changes.latestPiiOpsecResult?.newValue;
                const fallback = changes.piiRisk?.newValue;
                this.latestPrivacyResult = latest || fallback || null;
                this.renderPrivacyRiskBubbles();
            }
        });
    }

    renderPrivacyRiskBubbles() {
        this.clearPrivacyChatMessages();

        if (!this.latestPrivacyResult) return;

        const riskLevelRaw = this.latestPrivacyResult.risk_level || 'low';
        const riskLevel = String(riskLevelRaw).toLowerCase();

        if (riskLevel === 'low' || riskLevel === 'none') return;

        const readableRisk = riskLevel === 'high' ? 'higher' : 'possible';

        const summaryExplanation = String(this.latestPrivacyResult.summary_explanation || '').trim();
        const advice = String(this.latestPrivacyResult.advice || '').trim();
        const safeRewrite = String(this.latestPrivacyResult.safe_rewrite || '').trim();

        const bubble1 = `🛡️ **PII / OpSec Alert**\n\nHey, you may be putting yourself at ${readableRisk} risk by sharing this publicly.`;

        const bubble2 = `Here is why:\n\n${
            summaryExplanation || 'This draft contains personal or safety-related details that could be misused.'
        }`;

        const bubble3 = `To stay on the safer side:\n\n${
            advice || 'Review the post before sharing and remove exact personal details where possible.'
        }`;

        this.showPrivacyChatMessage(bubble1, 'privacyRiskMessage1');
        this.showPrivacyChatMessage(bubble2, 'privacyRiskMessage2');
        this.showPrivacyChatMessage(bubble3, 'privacyRiskMessage3');

        if (safeRewrite) {
            const bubble4 = `Suggested safer version:\n\n${safeRewrite}`;
            this.showPrivacyChatMessage(bubble4, 'privacyRiskMessage4');
        }
    }

    showPrivacyChatMessage(text, elementId) {
        if (!this.chatMessages) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message privacy-message';
        messageDiv.id = elementId;

        const formattedText = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        messageDiv.innerHTML = formattedText;

        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    clearPrivacyChatMessages() {
        const ids = [
            'privacyRiskMessage1',
            'privacyRiskMessage2',
            'privacyRiskMessage3',
            'privacyRiskMessage4'
        ];

        ids.forEach((id) => {
            const oldMessage = document.getElementById(id);
            if (oldMessage) {
                oldMessage.remove();
            }
        });
    }

    setButtonsDisabled(disabled) {
        if (this.sendButton) this.sendButton.disabled = disabled;
    }

    setFeatureEnabled(enabled) {
        this.subscriptionActive = Boolean(enabled);
        if (this.sendButton) this.sendButton.disabled = !enabled;
        if (this.userInput) this.userInput.disabled = !enabled;
    }

    async ensureSubscription() {
        try {
            let status = await this.getSubscriptionStatus();
            if (status.active) {
                this.applySubscriptionStatus(status);
                return true;
            }

            const enteredCode = window.prompt(
                'Enter your subscription code.\nPlans: FREE(1 month), PERSONAL(3 months), PRO(6 months), ENTERPRISE(12 months).'
            );

            if (!enteredCode) {
                this.applySubscriptionStatus({
                    active: false,
                    plan: null,
                    remainingMs: 0
                });
                return false;
            }

            const redeemResponse = await this.redeemSubscriptionCode(enteredCode);
            if (!redeemResponse.success) {
                this.addSystemMessage(`❌ ${redeemResponse.error || 'Code redemption failed.'}`);
                this.applySubscriptionStatus({
                    active: false,
                    plan: null,
                    remainingMs: 0
                });
                return false;
            }

            status = await this.getSubscriptionStatus();
            this.applySubscriptionStatus(status);
            this.addSystemMessage(`✅ ${status.plan.toUpperCase()} subscription activated.`);
            return true;
        } catch (error) {
            console.error('Subscription check failed:', error);
            this.addSystemMessage('❌ Subscription validation failed.');
            this.applySubscriptionStatus({
                active: false,
                plan: null,
                remainingMs: 0
            });
            return false;
        }
    }

    async getSubscriptionStatus() {
        return await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'getSubscriptionStatus' }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                resolve(response || { success: false, active: false, remainingMs: 0 });
            });
        });
    }

    async redeemSubscriptionCode(code) {
        return await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { action: 'redeemSubscriptionCode', code },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                        return;
                    }
                    resolve(response || { success: false, error: 'No response from background.' });
                }
            );
        });
    }

    applySubscriptionStatus(status) {
        const isActive = Boolean(status?.active);
        this.setFeatureEnabled(isActive);
        this.updateSubscriptionStatusUI(status || { active: false, plan: null, remainingMs: 0 });
        this.startSubscriptionCountdown(status || { active: false, remainingMs: 0 });
    }

    updateSubscriptionStatusUI(status) {
        if (this.subscriptionPlan) {
            this.subscriptionPlan.textContent = status.active
                ? String(status.plan || '').toUpperCase()
                : 'Inactive';
        }
        if (this.subscriptionCountdown) {
            this.subscriptionCountdown.textContent = this.formatDuration(
                Number(status.remainingMs || 0)
            );
        }
    }

    startSubscriptionCountdown(status) {
        if (this.subscriptionTimer) {
            clearInterval(this.subscriptionTimer);
            this.subscriptionTimer = null;
        }

        if (!status.active) return;

        const expiresAt = Number(status.expiresAt || 0);
        if (!expiresAt) return;

        const tick = () => {
            const remainingMs = Math.max(0, expiresAt - Date.now());
            this.updateSubscriptionStatusUI({
                active: remainingMs > 0,
                plan: status.plan,
                remainingMs
            });

            if (remainingMs <= 0) {
                clearInterval(this.subscriptionTimer);
                this.subscriptionTimer = null;
                this.setFeatureEnabled(false);
                this.addSystemMessage('⌛ Subscription expired. Enter a new code to continue.');
            }
        };

        tick();
        this.subscriptionTimer = setInterval(tick, 1000);
    }

    formatDuration(ms) {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        return `${String(days).padStart(2, '0')}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }

    showTypingIndicator(text = '🤔 Analyzing...') {
        this.removeTypingIndicator();

        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot-message typing-indicator';
        typingDiv.id = 'typingIndicator';
        typingDiv.textContent = text;

        this.chatMessages.appendChild(typingDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    removeTypingIndicator() {
        const existing = document.getElementById('typingIndicator');
        if (existing) existing.remove();
    }

    addMessage(sender, text, extraClass = '') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message ${extraClass}`.trim();

        const formattedText = String(text)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');

        messageDiv.innerHTML = formattedText;
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    addSystemMessage(text) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system-message';
        messageDiv.innerHTML = text;
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    updateMisinfoStatus(text, className = '') {
        if (!this.misinfoResult) return;
        this.misinfoResult.textContent = text;
        this.misinfoResult.className = className;
    }

    showMisinfoActionButtons(show) {
        if (!this.actionButtons) return;
        this.actionButtons.style.display = show ? 'grid' : 'none';
    }

    async sendMessage() {
        if (!this.subscriptionActive) {
            this.addSystemMessage('⚠️ Subscription inactive. Reopen popup and enter a valid code.');
            return;
        }

        const message = this.userInput?.value.trim();
        if (!message) return;

        this.currentMessage = message;
        this.currentResponse = null;

        this.addMessage('user', message);
        this.userInput.value = '';
        this.autoResizeTextarea();
        this.showMisinfoActionButtons(false);
        this.setButtonsDisabled(true);
        this.showTypingIndicator('🔎 Checking misinformation...');

        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    action: 'processMessage',
                    message
                }, (resp) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(resp);
                    }
                });
            });

            this.removeTypingIndicator();

            if (response?.success) {
                this.currentResponse = {
                    is_misinformation: response.is_misinformation,
                    is_factual: response.is_factual
                };

                const bubbleClass =
                    response.is_misinformation === true
                        ? 'misinfo-detected'
                        : response.is_misinformation === false
                            ? 'factual-info'
                            : '';

                this.addMessage('bot', response.answer || 'Analysis complete.', bubbleClass);

                if (response.is_misinformation === true) {
                    this.updateMisinfoStatus('MISINFORMATION DETECTED 🚨', 'misinfo-alert');
                    this.showMisinfoActionButtons(true);
                } else if (response.is_misinformation === false) {
                    this.updateMisinfoStatus('FACTUAL INFORMATION ✅', 'factual-alert');
                    this.showMisinfoActionButtons(false);
                } else {
                    this.updateMisinfoStatus('ANALYSIS READY');
                    this.showMisinfoActionButtons(false);
                }
            } else {
                this.addMessage('bot', response?.answer || '⚠️ Analysis failed.');
                this.updateMisinfoStatus('READY');
                this.showMisinfoActionButtons(false);
            }
        } catch (error) {
            console.error('Misinformation analysis failed:', error);
            this.removeTypingIndicator();
            this.addSystemMessage('❌ Failed to analyze misinformation.');
            this.updateMisinfoStatus('READY');
            this.showMisinfoActionButtons(false);
        }

        this.setButtonsDisabled(false);
    }

    async trackUserAction(action) {
        if (!this.currentMessage || !this.currentResponse) return;

        try {
            await new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    action: 'trackUserAction',
                    message: this.currentMessage,
                    aiResponse: this.currentResponse,
                    userAction: action
                }, resolve);
            });

            this.showMisinfoActionButtons(false);
            await this.loadUserData();

            const messages = {
                questioned: '❓ You questioned this result. Your feedback helps improve the system.',
                accepted: '✅ You accepted the correction. Great job staying informed!',
                rejected: '❌ You rejected the correction. Your feedback has been noted.'
            };

            this.addSystemMessage(messages[action] || 'Action recorded.');
        } catch (error) {
            console.error('Error tracking user action:', error);
            this.addSystemMessage('❌ Failed to record your feedback.');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new ChatInterface();
});