// =====================
// onboarding.js - FIRST INSTALLATION FORM
// =====================

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('onboardingForm');
    const nameInput = document.getElementById('userName');
    const ageSelect = document.getElementById('ageGroup');
    const educationSelect = document.getElementById('educationLevel');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Validate form
        let isValid = true;
        
        if (!nameInput.value.trim()) {
            showError('nameError');
            isValid = false;
        } else {
            hideError('nameError');
        }
        
        if (!ageSelect.value) {
            showError('ageError');
            isValid = false;
        } else {
            hideError('ageError');
        }
        
        if (!educationSelect.value) {
            showError('educationError');
            isValid = false;
        } else {
            hideError('educationError');
        }
        
        if (!isValid) {
            return;
        }
        
        // Save user data
        const userData = {
            name: nameInput.value.trim(),
            ageGroup: ageSelect.value,
            educationLevel: educationSelect.value,
            installationDate: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            // Initialize behavioral tracking
            behaviorData: {
                misinformationDetected: 0,
                timesQuestioned: 0,
                repeatedFalseContent: 0,
                correctionsAccepted: 0,
                correctionsRejected: 0,
                interactions: []
            },
            susceptibilityScore: null,
            riskLevel: null
        };
        
        try {
            // Save to chrome storage
            await chrome.storage.local.set({ 
                userData: userData,
                onboardingCompleted: true
            });
            
            // Calculate initial susceptibility score
            const score = calculateSusceptibilityScore(userData);
            userData.susceptibilityScore = score.score;
            userData.riskLevel = score.riskLevel;
            
            // Update with score
            await chrome.storage.local.set({ userData: userData });
            
            // Close onboarding and open popup
            window.close();
            
            // Open the extension popup
            chrome.action.openPopup();
            
        } catch (error) {
            console.error('Error saving user data:', error);
            alert('Error saving your information. Please try again.');
        }
    });
    
    function showError(errorId) {
        document.getElementById(errorId).style.display = 'block';
    }
    
    function hideError(errorId) {
        document.getElementById(errorId).style.display = 'none';
    }
    
    function calculateSusceptibilityScore(userData) {
        let score = 50; // Base score
        
        // Age group factors
        const ageFactors = {
            'under_18': 15,  // Higher risk
            '18_25': 10,
            '26_40': 5,
            'above_40': 0
        };
        score += ageFactors[userData.ageGroup] || 0;
        
        // Education level factors
        const educationFactors = {
            'school': 15,  // Higher risk
            'undergraduate': 5,
            'postgraduate': -5,  // Lower risk
            'other': 10
        };
        score += educationFactors[userData.educationLevel] || 0;
        
        // Clamp score between 0-100
        score = Math.max(0, Math.min(100, score));
        
        // Determine risk level
        let riskLevel;
        if (score < 30) {
            riskLevel = 'Low';
        } else if (score < 70) {
            riskLevel = 'Medium';
        } else {
            riskLevel = 'High';
        }
        
        return { score, riskLevel };
    }
});
