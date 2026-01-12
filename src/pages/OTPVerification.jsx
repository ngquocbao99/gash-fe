import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import emailjs from '@emailjs/browser';
import ProductButton from '../components/ProductButton';

// Initialize EmailJS with Public API Key
if (!import.meta.env.VITE_EMAILJS_PUBLIC_KEY) {
  console.error("EmailJS Public Key is missing. Please check .env file.");
} else {
  emailjs.init(import.meta.env.VITE_EMAILJS_PUBLIC_KEY);
}


const OTPVerification = () => {
  const [otp, setOTP] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { verifyOTP } = React.useContext(AuthContext);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const otpRef = useRef(null);

  const { email, type, formData } = location.state || {};

  useEffect(() => {
    if (!email || !type) {
      navigate(type === 'forgot-password' ? '/forgot-password' : '/signup');
    }
    otpRef.current?.focus();
  }, [email, type, navigate]);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (!otp || otp.trim() === '') {
        showToast('Please fill in all required fields', 'error', 3000);
        otpRef.current?.focus();
        return;
      }
      if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
        showToast('Please enter a valid 6-digit OTP', 'error', 3000);
        otpRef.current?.focus();
        return;
      }

      setIsLoading(true);
      try {
        if (type === 'register') {
          await verifyOTP(email, otp, formData, 'register');
          showToast('OTP verified successfully', 'success', 2000);
          navigate('/register', { state: { email, formData } });
        } else if (type === 'forgot-password') {
          await verifyOTP(email, otp, null, 'forgot-password');
          showToast('OTP verified successfully', 'success', 2000);
          navigate('/reset-password', { state: { email, otp } });
        }
      } catch (err) {
        const errorMsg = err.response?.data?.message || 'Invalid or expired OTP';
        showToast(errorMsg, 'error', 3000);
        otpRef.current?.focus();
      } finally {
        setIsLoading(false);
      }
    },
    [otp, email, type, formData, verifyOTP, navigate, showToast]
  );

  const handleInputChange = useCallback((e) => {
    setOTP(e.target.value);
  }, []);

  const handleResendOTP = useCallback(
    async () => {
      setIsLoading(true);
      try {
        const response = await verifyOTP(email, null, formData, type, true);
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

        // For development: Skip EmailJS and show OTP in console
        if (!import.meta.env.VITE_EMAILJS_PUBLIC_KEY || import.meta.env.VITE_EMAILJS_PUBLIC_KEY === 'your_emailjs_public_key_here') {
          showToast(
            type === 'forgot-password'
              ? `New OTP for password reset: ${otp} (Check console)`
              : `New OTP: ${otp} (Check console)`,
            'success',
            5000
          );
        } else {
          await emailjs.send(
            import.meta.env.VITE_EMAILJS_SERVICE_ID,
            import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
            templateParams
          );

          showToast(
            type === 'forgot-password'
              ? 'A new OTP for password reset has been sent to your email.'
              : 'A new OTP has been sent to your email.',
            'success',
            3000
          );
        }
        setOTP('');
        otpRef.current?.focus();
      } catch (err) {
        showToast(err.response?.data?.message || 'Failed to resend OTP', 'error', 3000);
        console.error('Error resending OTP:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [email, formData, type, verifyOTP, showToast]
  );

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-7xl mx-auto min-h-[calc(100vh-6rem)] p-3 sm:p-4 md:p-5 lg:p-6 text-gray-900">
      <section className="bg-white rounded-xl p-4 sm:p-5 md:p-6 w-full max-w-sm shadow-sm border border-gray-200">
        <h1 className="text-xl sm:text-2xl md:text-2xl font-semibold mb-4 sm:mb-5 md:mb-6 text-center text-gray-900">
          Verify OTP
        </h1>
        
        <p className="text-sm text-gray-600 mb-4 sm:mb-5 text-center">
          Enter the 6-digit OTP sent to {email} to{' '}
          {type === 'forgot-password' ? 'reset your password' : 'verify your email'}.
        </p>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 sm:space-y-5"
        >
          <fieldset className="flex flex-col">
            <label htmlFor="otp" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
              OTP <span className="text-red-600">*</span>
            </label>
            <input
              id="otp"
              type="text"
              name="otp"
              value={otp}
              onChange={handleInputChange}
              ref={otpRef}
              required
              maxLength={6}
              className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-center text-2xl tracking-widest"
              aria-required="true"
              placeholder="000000"
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
            {isLoading ? 'Verifying...' : 'Verify OTP'}
          </ProductButton>
        </form>

        <p className="text-center text-sm text-gray-600 mt-4 sm:mt-5">
          Didn't receive an OTP?{' '}
          <ProductButton
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleResendOTP}
            disabled={isLoading}
            className="inline"
          >
            Resend OTP
          </ProductButton>
        </p>
      </section>
    </div>
  );
};

export default OTPVerification;