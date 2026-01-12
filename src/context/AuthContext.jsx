// Updated AuthContext.jsx (updated interceptor to handle 403 for inactive/suspended, added polling for status check every 1 minute, renamed handleSessionExpired to handleForcedLogout for generality)
import React, { createContext, useState, useEffect, useContext } from 'react';
import axiosClient from '../common/axiosClient';
import { useNavigate } from 'react-router-dom';
import { ToastContext } from './ToastContext'; // Import ToastContext

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();
  const { showToast } = useContext(ToastContext); // Get showToast

  const handleForcedLogout = (message) => {
    showToast(message, 'error');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('loginTime');
    setUser(null);
    navigate('/login');
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    const loginTime = localStorage.getItem('loginTime');

    if (token && storedUser && loginTime) {
      const currentTime = Date.now();
      const sessionDuration = 24 * 60 * 60 * 1000; // 1 day
      const timeElapsed = currentTime - parseInt(loginTime);

      if (timeElapsed >= sessionDuration) {
        handleForcedLogout('Your session has expired. You will be logged out.');
      } else {
        setUser(JSON.parse(storedUser));
        const remainingTime = sessionDuration - timeElapsed;
        setTimeout(() => {
          handleForcedLogout('Your session has expired. You will be logged out.');
        }, remainingTime);
      }
    }
  }, [showToast]);

  useEffect(() => {
    const interceptor = axiosClient.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response) {
          const status = error.response.status;
          const msg = error.response.data?.message || '';
          if (status === 401 || (status === 403 && msg.includes('inactive'))) {
            if (localStorage.getItem('token')) {
              const logoutMessage = status === 401 
                ? 'Your session has expired or token is invalid. You will be logged out.'
                : 'Your account has been suspended or deactivated. You will be logged out.';
              handleForcedLogout(logoutMessage);
            }
          }
        }
        return Promise.reject(error);
      }
    );

    return () => axiosClient.interceptors.response.eject(interceptor);
  }, [showToast]);

  // Added: Polling to check account status every 1 minute for near-immediate logout if status changes
  useEffect(() => {
    let interval;
    if (user) {
      interval = setInterval(async () => {
        try {
          await axiosClient.get('/auth/check-status');
        } catch (error) {
          // Interceptor will handle logout if 403 due to inactive
        }
      }, 60000); // Every 1 minute
    }
    return () => clearInterval(interval);
  }, [user]);

  const login = async (username, password) => {
    try {
      const response = await axiosClient.post('/auth/login', {
        username,
        password,
      });

      const { token, account } = response.data;
      const loginTime = Date.now().toString();

      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(account));
      localStorage.setItem('loginTime', loginTime);
      setUser(account);



      setTimeout(() => {
        handleForcedLogout('Your session has expired. You will be logged out.');
      }, 24 * 60 * 60 * 1000);

      navigate('/');
    } catch (error) {
      const msg = error.response?.data?.message || 'Login failed. Please try again.';
      showToast(msg, 'error');
      throw error;
    }
  };

  const googleLogin = async (token) => {
    try {
      const response = await axiosClient.post('/auth/google-login', { token });

      const { token: jwtToken, account } = response.data;
      const loginTime = Date.now().toString();

      localStorage.setItem('token', jwtToken);
      localStorage.setItem('user', JSON.stringify(account));
      localStorage.setItem('loginTime', loginTime);
      setUser(account);

      showToast('Google logged in successfully', 'success');

      setTimeout(() => {
        handleForcedLogout('Your session has expired. You will be logged out.');
      }, 24 * 60 * 60 * 1000);

      navigate('/');
    } catch (error) {
      const msg = error.response?.data?.message || 'Google login failed.';
      showToast(msg, 'error');
      throw error;
    }
  };

  const requestSignupOTP = async (email, type = 'register') => {
    try {
      const endpoint =
        type === 'register'
          ? '/auth/register/request-otp'
          : '/auth/forgot-password/request-otp';
      const response = await axiosClient.post(endpoint, { email });
      showToast('OTP sent to your email.', 'info');
      return response;
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to send OTP.';
      showToast(msg, 'error');
      throw error;
    }
  };

  const verifyOTP = async (email, otp, formData, type, resend = false) => {
    try {
      if (resend) {
        const endpoint =
          type === 'register'
            ? '/auth/register/request-otp'
            : '/auth/forgot-password/request-otp';
        const response = await axiosClient.post(endpoint, { email });
        showToast('OTP resent successfully', 'info');
        return response;
      }

      let response;
      if (type === 'register') {
        response = await axiosClient.post('/auth/register/verify-otp', { email, otp });
      } else if (type === 'forgot-password') {
        response = await axiosClient.post('/auth/forgot-password/verify-otp', { email, otp });
      }

      showToast('OTP verified successfully', 'success');
      return response;
    } catch (error) {
      const msg = error.response?.data?.message || 'Invalid or expired OTP.';
      showToast(msg, 'error');
      throw error;
    }
  };

  const signup = async (formData) => {
    try {
      const response = await axiosClient.post('/auth/register', { ...formData });

      const { token, account } = response.data;
      const loginTime = Date.now().toString();

      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(account));
      localStorage.setItem('loginTime', loginTime);
      setUser(account);

      showToast('Account created successfully', 'success');

      setTimeout(() => {
        handleForcedLogout('Your session has expired. You will be logged out.');
      }, 24 * 60 * 60 * 1000);

      navigate('/');
    } catch (error) {
      console.error('Signup error:', error.response?.data || error.message);
      const msg = error.response?.data?.message || 'Signup failed. Please try again.';
      showToast(msg, 'error');
      throw error;
    }
  };

  const resetPassword = async ({ email, newPassword }) => {
    try {
      await axiosClient.post('/auth/forgot-password/reset', {
        email,
        newPassword,
      });
      showToast('Password reset successfully', 'success');
    } catch (error) {
      const msg = error.response?.data?.message || 'Failed to reset password.';
      showToast(msg, 'error');
      throw error;
    }
  };

  const passkeyLogin = async (username) => {
    try {
      const { startAuthentication } = await import('@simplewebauthn/browser');
      
      // Step 1: Get authentication options from server
      const response = await axiosClient.post('/passkeys/auth/generate', { username });
      const { options } = response.data;

      // Step 2: Start authentication with browser
      const authenticationResponse = await startAuthentication(options);

      // Step 3: Verify authentication with server
      const verifyResponse = await axiosClient.post('/passkeys/auth/verify', {
        username,
        ...authenticationResponse,
        challenge: options.challenge,
      });

      const { token, account } = verifyResponse.data;
      const loginTime = Date.now().toString();

      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(account));
      localStorage.setItem('loginTime', loginTime);
      setUser(account);

      showToast('Passkey logged in successfully', 'success');

      setTimeout(() => {
        handleForcedLogout('Your session has expired. You will be logged out.');
      }, 24 * 60 * 60 * 1000);

      navigate('/');
    } catch (error) {
      const msg = error.response?.data?.message || 'Passkey login failed. Please try again.';
      showToast(msg, 'error');
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('loginTime');
    setUser(null);
    navigate('/login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        googleLogin,
        passkeyLogin,
        requestSignupOTP,
        verifyOTP,
        signup,
        resetPassword,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};