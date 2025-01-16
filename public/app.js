function feedbackForm() {
    return {
        name: '',
        email: '',
        npsScore: null,
        feedback: '',
        message: '',
        isSubmitting: false,
        
        async init() {
            // Check for token in URL
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');
            
            if (token) {
                try {
                    const response = await fetch('/api/verify-token', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ token })
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        this.name = data.name;
                        this.email = data.email;
                        
                        // Remove token from URL without refreshing the page
                        window.history.replaceState({}, document.title, window.location.pathname);
                    }
                } catch (error) {
                    console.error('Error verifying token:', error);
                }
            }
        },
        
        async submitForm() {
            if (this.isSubmitting) return;
            
            this.isSubmitting = true;
            try {
                const response = await fetch('/api/feedback', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        name: this.name,
                        email: this.email,
                        npsScore: this.npsScore,
                        feedback: this.feedback
                    })
                });

                const data = await response.json();
                
                if (response.ok) {
                    this.message = data.message;
                    // Reset form
                    this.name = '';
                    this.email = '';
                    this.npsScore = null;
                    this.feedback = '';
                    // Clear message after 5 seconds
                    setTimeout(() => this.message = '', 5000);
                } else {
                    throw new Error(data.error || 'Something went wrong');
                }
            } catch (error) {
                this.message = error.message;
            } finally {
                this.isSubmitting = false;
            }
        }
    }
}