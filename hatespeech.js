class HateSpeechWindow {
    constructor() {
        this.chatMessages = document.getElementById('hateChatMessages');
        this.userInput = document.getElementById('hateSpeechInput');
        this.analyzeBtn = document.getElementById('hateSpeechAnalyzeBtn');
        this.monitorToggleBtn = document.getElementById('hateMonitorToggleBtn');
        this.monitorStatus = document.getElementById('hateMonitorStatus');
        this.hateMonitoringEnabled = false;

        this.monitorToggleBtn?.addEventListener('click', () => this.toggleMonitoring());
        this.analyzeBtn?.addEventListener('click', () => this.analyzeHateSpeech());
        this.userInput?.addEventListener('input', () => this.autoResizeTextarea());

        void this.loadPendingSelectedText();
        this.loadHateMonitoringState();
    }

    async loadPendingSelectedText() {
        try {
            const data = await chrome.storage.local.get([
                'pendingSelectedText',
                'pendingSelectedTextUrl',
                'pendingSelectedTextTs'
            ]);
            const selectedText = (data.pendingSelectedText || '').trim();
            if (!selectedText || !this.userInput) return;

            this.userInput.value = selectedText;
            this.autoResizeTextarea();
            this.userInput.focus();

            await chrome.storage.local.remove([
                'pendingSelectedText',
                'pendingSelectedTextUrl',
                'pendingSelectedTextTs'
            ]);
        } catch (e) {
            console.error('Failed to load pending text:', e);
        }
    }

    autoResizeTextarea() {
        if (!this.userInput) return;
        this.userInput.style.height = 'auto';
        const nextHeight = Math.min(this.userInput.scrollHeight, 160);
        this.userInput.style.height = `${nextHeight}px`;
    }

    async loadHateMonitoringState() {
        try {
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: 'getHateSpeechMonitoring' }, resolve);
            });
            this.hateMonitoringEnabled = Boolean(response?.enabled);
            this.updateMonitoringUI();
        } catch (e) {
            console.error('Error loading hate speech monitoring:', e);
            this.hateMonitoringEnabled = false;
            this.updateMonitoringUI();
        }
    }

    updateMonitoringUI() {
        if (this.monitorToggleBtn) {
            this.monitorToggleBtn.textContent = this.hateMonitoringEnabled
                ? 'Stop Monitoring This Page'
                : 'Start Monitoring This Page';
        }
        if (this.monitorStatus) {
            this.monitorStatus.textContent = this.hateMonitoringEnabled
                ? 'Hate speech monitoring is active for Facebook / X.'
                : 'Hate speech monitoring is off.';
        }
    }

    async toggleMonitoring() {
        try {
            const nextState = !this.hateMonitoringEnabled;
            const response = await new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { action: 'setHateSpeechMonitoring', enabled: nextState },
                    resolve
                );
            });
            if (!response || response.success === false) {
                this.addSystemMessage('❌ Failed to update monitoring state.');
                return;
            }
            this.hateMonitoringEnabled = Boolean(response.enabled);
            this.updateMonitoringUI();
            if (this.hateMonitoringEnabled) {
                this.addSystemMessage('🟤 Hate speech monitoring is now ON for this page.');
            } else {
                this.addSystemMessage('🔴 Hate speech monitoring is now OFF.');
            }
        } catch (error) {
            console.error('Error toggling monitoring:', error);
            this.addSystemMessage('❌ Failed to toggle monitoring.');
        }
    }

    addSystemMessage(text) {
        if (!this.chatMessages) return;
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system-message';
        messageDiv.textContent = text;
        this.chatMessages.appendChild(messageDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    addMessage(sender, text, extraClass = '') {
        if (!this.chatMessages) return;
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

    showTypingIndicator(text = '🟤 Analyzing…') {
        this.removeTypingIndicator();
        if (!this.chatMessages) return;
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot-message typing-indicator';
        typingDiv.id = 'hateTypingIndicator';
        typingDiv.textContent = text;
        this.chatMessages.appendChild(typingDiv);
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    removeTypingIndicator() {
        document.getElementById('hateTypingIndicator')?.remove();
    }

    async analyzeHateSpeech() {
        const text = this.userInput?.value.trim();
        if (!text) return;

        this.addMessage('user', text);
        this.userInput.value = '';
        this.autoResizeTextarea();
        this.analyzeBtn.disabled = true;
        this.showTypingIndicator('🟤 Checking hate / offensive language…');

        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ action: 'analyzeHateSpeechText', text }, (resp) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(resp);
                    }
                });
            });

            this.removeTypingIndicator();

            if (!response?.success || !response?.result) {
                this.addSystemMessage(
                    `❌ Hate speech analysis failed${response?.error ? `: ${response.error}` : '.'}`
                );
                this.analyzeBtn.disabled = false;
                return;
            }

            const result = response.result;
            const label = String(result.label || 'neutral').toLowerCase();
            const confidencePercent = Math.round(Number(result.confidence || 0) * 100);
            const explanation = result.explanation || 'No explanation available.';
            const matches = Array.isArray(result.matches) ? result.matches : [];
            const severity = String(result.severity || 'none').toLowerCase();

            let title = '🟤 Hate Speech Analysis';
            let bubbleClass = 'hate-message-medium';

            if (label === 'hate') {
                title = '🚨 Hate Speech Detected';
                bubbleClass = 'hate-message-high';
            } else if (label === 'offensive') {
                title = '⚠️ Offensive Language Detected';
                bubbleClass = 'hate-message-medium';
            } else {
                title = '✅ No Hate Speech Detected';
                bubbleClass = 'bot-message';
            }

            const matchesText = matches.length > 0 ? `\n\nDetected cues: ${matches.join(', ')}` : '';
            const details = `**Result:** ${label.toUpperCase()}\n**Confidence:** ${confidencePercent}%\n**Severity:** ${severity}\n\n${explanation}${matchesText}`;

            this.addMessage('bot', `**${title}**\n\n${details}`, bubbleClass);
            this.addSystemMessage('🟤 Hate speech analysis completed.');
        } catch (error) {
            console.error('Hate speech analysis failed:', error);
            this.removeTypingIndicator();
            this.addSystemMessage('❌ Failed to analyze hate speech.');
        }

        this.analyzeBtn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const panel = new HateSpeechWindow();
    try {
        const data = await chrome.storage.local.get(['hatespeechShowFabWelcome']);
        if (data.hatespeechShowFabWelcome) {
            await chrome.storage.local.remove(['hatespeechShowFabWelcome']);
            panel.addSystemMessage(
                '🕶️ Specter — Monitoring is on for this tab. Paste text below or keep scrolling the feed.'
            );
        }
    } catch (e) {
        // ignore
    }
});
