import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import { useToast } from '../../hooks/useToast';
import emailjs from '@emailjs/browser';
import ProductButton from '../../components/ProductButton';

// Initialize EmailJS with Public API Key
const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

if (!publicKey) {
  console.error('EmailJS Public Key is missing. Please check .env file.');
} else {
  emailjs.init(publicKey);
}

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { requestSignupOTP } = React.useContext(AuthContext);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const emailRef = useRef(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const handleChange = useCallback((e) => {
    setEmail(e.target.value);
  }, []);

  const validateEmail = useCallback(() => {
    if (!email.trim()) return 'Please fill in all required fields';
    if (!/^\S+@\S+\.\S+$/.test(email)) return 'Invalid email address';
    return '';
  }, [email]);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      const validationError = validateEmail();
      if (validationError) {
        showToast(validationError, 'error', 5000);
        emailRef.current?.focus();
        return;
      }

      setIsLoading(true);
      try {
        const response = await requestSignupOTP(email, 'forgot-password');
        const { otp } = response.data;

        const templateParams = {
          to_email: email.trim(),
          otp: otp,
        };

        if (!templateParams.to_email) {
          throw new Error('Recipient email is empty');
        }
        if (!templateParams.otp) {
          throw new Error('OTP is missing');
        }

        const emailjsResponse = await emailjs.send(
          import.meta.env.VITE_EMAILJS_SERVICE_ID,
          import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
          templateParams
        );
        showToast('OTP sent successfully', 'success', 3000);

        navigate('/otp-verification', {
          state: { email, type: 'forgot-password' },
        });
      } catch (err) {
        console.error('Error:', err.status, err.text || err.message);
        let errorMsg = '';
        if (err.status === 422) {
          errorMsg = 'Failed to send OTP: Invalid email configuration. Please check your email and try again.';
        } else if (err.response?.status === 404 || err.response?.data?.message?.includes('No account found')) {
          errorMsg = 'No account found with this email';
        } else if (err.response?.data?.message) {
          errorMsg = err.response.data.message;
        } else {
          errorMsg = err.message || 'Failed to send OTP. Please try again.';
        }
        showToast(errorMsg, 'error', 5000);
        emailRef.current?.focus();
      } finally {
        setIsLoading(false);
      }
    },
    [email, requestSignupOTP, navigate, validateEmail, showToast]
  );

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-7xl mx-auto min-h-[calc(100vh-6rem)] p-3 sm:p-4 md:p-5 lg:p-6 text-gray-900">
      <section className="bg-white rounded-xl p-4 sm:p-5 md:p-6 w-full max-w-sm shadow-sm border border-gray-200">
        <h1 className="text-xl sm:text-2xl md:text-2xl font-semibold mb-4 sm:mb-5 md:mb-6 text-center text-gray-900">
          Reset Your Password
        </h1>

        <p className="text-sm text-gray-600 mb-4 sm:mb-5 text-center">
          Enter your email address to receive a password reset OTP.
        </p>

        <form
          onSubmit={handleSubmit}
          aria-label="Forgot Password form"
          className="space-y-4 sm:space-y-5"
        >
          <fieldset className="flex flex-col">
            <label htmlFor="email" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
              Email <span className="text-red-600">*</span>
            </label>
            <input
              id="email"
              type="email"
              name="email"
              value={email}
              onChange={handleChange}
              ref={emailRef}
              required
              className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
              aria-required="true"
              placeholder="Enter your email"
            />
          </fieldset>

          <ProductButton
            type="submit"
            variant="primary"
            size="lg"
            disabled={isLoading}
            aria-busy={isLoading}
            className="w-full"
          >
            <span aria-live="polite">
              {isLoading ? 'Sending OTP...' : 'Continue'}
            </span>
          </ProductButton>
        </form>

        <p className="text-center text-sm text-gray-600 mt-4 sm:mt-5">
          Remember your password?{' '}
          <Link
            to="/login"
            className="text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors focus:outline-none rounded"
          >
            Sign In
          </Link>
        </p>
      </section>
    </div>
  );
};

export default ForgotPassword;