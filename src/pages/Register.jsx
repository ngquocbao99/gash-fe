import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import Api from '../common/SummaryAPI';
import ProductButton from '../components/ProductButton';

const Register = () => {
  const location = useLocation();
  const [formData, setFormData] = useState({
    username: location.state?.formData?.username || '',
    name: location.state?.formData?.name || '',
    email: location.state?.email || '',
    phone: location.state?.formData?.phone || '',
    address: location.state?.formData?.address || '',
    gender: location.state?.formData?.gender || '',
    dob: location.state?.formData?.dob || '',
    password: location.state?.formData?.password || '',
    repeatPassword: location.state?.formData?.repeatPassword || '',
    role: 'user',
    acc_status: 'active',
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [invalidFile, setInvalidFile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { signup } = React.useContext(AuthContext);
  const { showToast } = useToast();
  const navigate = useNavigate();
  const usernameRef = useRef(null);

  useEffect(() => {
    if (!location.state?.email) {
      navigate('/signup');
    }
    usernameRef.current?.focus();
  }, [location.state, navigate]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const validTypes = ['image/png', 'image/jpeg', 'image/jpg'];
      if (!validTypes.includes(file.type.toLowerCase())) {
        showToast("Profile Image must be a PNG or JPG image URL", "error", 3000);
        setInvalidFile(true);
        setSelectedFile(null);
        setPreviewUrl("");
        return;
      }
      setInvalidFile(false);
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setInvalidFile(false);
      setSelectedFile(null);
      setPreviewUrl("");
    }
  };

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }, []);

  const validateForm = useCallback(() => {
    const username = formData.username.trim();
    const name = formData.name.trim();
    const email = formData.email.trim();
    const phone = formData.phone.trim();
    const address = formData.address.trim();
    const password = formData.password.trim();
    const repeatPassword = formData.repeatPassword.trim();

    // Check required fields
    if (!username) return 'Please fill in all required fields';
    if (!name) return 'Please fill in all required fields';
    if (!email) return 'Please fill in all required fields';
    if (!phone) return 'Please fill in all required fields';
    if (!address) return 'Please fill in all required fields';
    if (!password) return 'Please fill in all required fields';
    if (!repeatPassword) return 'Please fill in all required fields';

    if (username.length < 5 || username.length > 30) return 'Username must be between 5 and 30 characters';
    if (name.length < 1 || name.length > 50) return 'Fullname must be between 1 and 50 characters';
    if (!/^\S+@\S+\.\S+$/.test(email)) return 'Please enter a valid email address';
    if (!/^\d{10}$/.test(phone)) return 'Phone must be exactly 10 digits';
    if (address.length > 200) return 'Address must be at most 200 characters';
    
    // Password validation: at least 8 characters, at least 3 of 4 character types
    if (password.length < 8) {
      return 'Passwords must be at least 8 characters and include three of four types: uppercase, lowercase, number, or special';
    }
    
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    const characterTypesMet = [hasUpperCase, hasLowerCase, hasNumber, hasSpecial].filter(Boolean).length;
    
    if (characterTypesMet < 3) {
      return 'Passwords must be at least 8 characters and include three of four types: uppercase, lowercase, number, or special';
    }
    
    if (password !== repeatPassword) return 'Repeat password does not match';
    if (invalidFile) return 'Profile Image must be a PNG or JPG image URL';
    return '';
  }, [formData, invalidFile]);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      const validationError = validateForm();
      if (validationError) {
        showToast(validationError, 'error', 3000);
        usernameRef.current?.focus();
        return;
      }
      setIsLoading(true);

      try {
        // Skip image upload for now to debug register issue
        let imageUrl = '';
        if (selectedFile) {
          // const uploadResponse = await Api.upload.image(selectedFile);
          // imageUrl = uploadResponse.data?.url;
          // if (!imageUrl) {
          //   throw new Error('Upload completed but server did not return URL');
          // }
          // showToast('Image uploaded successfully', 'success', 2000);
        }

        // Filter out fields that backend doesn't expect
        const { repeatPassword, role, acc_status, ...filteredFormData } = formData;
        
        const signupData = {
          ...filteredFormData,
          image: imageUrl,
        };

        await signup(signupData);
        showToast('Register successfully', 'success', 2000);
        
        navigate('/');
      } catch (err) {
        console.error('Register error details:', {
          message: err.message,
          status: err.response?.status,
          data: err.response?.data,
          config: err.config
        });
        
        let errorMessage = 'Failed to create account. Please try again.';
        if (err.response?.status === 400) {
          errorMessage = err.response.data.message || 'Invalid input data';
        } else if (err.response?.status === 409) {
          errorMessage = 'Username already exists';
        } else if (err.response?.data?.errors) {
          errorMessage = err.response.data.errors[0]?.msg || errorMessage;
        } else if (err.message === 'Upload completed but server did not return URL') {
          errorMessage = err.message;
        } else if (err.code === 'NETWORK_ERROR' || err.message.includes('Network Error') || !err.response) {
          errorMessage = 'Failed to register. Please try again later.';
        }
        showToast(errorMessage, 'error', 4000);
        usernameRef.current?.focus();
      } finally {
        setIsLoading(false);
      }
    },
    [formData, selectedFile, invalidFile, signup, navigate, validateForm, showToast]
  );

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-7xl mx-auto min-h-[calc(100vh-6rem)] p-3 sm:p-4 md:p-5 lg:p-6 text-gray-900">
      <section className="bg-white rounded-xl p-4 sm:p-5 md:p-6 w-full max-w-5xl shadow-sm border border-gray-200">
        <h1 className="text-xl sm:text-2xl md:text-2xl font-semibold mb-4 sm:mb-5 md:mb-6 text-center text-gray-900">
          Complete Your Registration
        </h1>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {/* Left Column */}
            <div className="flex flex-col space-y-4 sm:space-y-5">
              {/* Username */}
              <fieldset className="flex flex-col">
                <label htmlFor="username" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
                  Username <span className="text-red-600">*</span>
                </label>
                <input
                  id="username"
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  ref={usernameRef}
                  required
                  maxLength={30}
                  className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  aria-required={true}
                />
              </fieldset>

              {/* Email */}
              <fieldset className="flex flex-col">
                <label htmlFor="email" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
                  Email <span className="text-red-600">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  readOnly
                  className="p-3 border-2 border-gray-300 rounded-md bg-gray-100 text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  aria-required={true}
                />
              </fieldset>

              {/* Address */}
              <fieldset className="flex flex-col">
                <label htmlFor="address" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
                  Address <span className="text-red-600">*</span>
                </label>
                <input
                  id="address"
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  required
                  maxLength={200}
                  className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  aria-required={true}
                />
              </fieldset>

              {/* Gender */}
              <fieldset className="flex flex-col">
                <label htmlFor="gender" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
                  Gender
                </label>
                <select
                  id="gender"
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  aria-required={false}
                >
                  <option value="">Select Gender</option>
                  {['Male', 'Female', 'Other'].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </fieldset>

              {/* Password */}
              <fieldset className="flex flex-col">
                <label htmlFor="password" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
                  Password <span className="text-red-600">*</span>
                </label>
                <input
                  id="password"
                  type="password"
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  aria-required={true}
                />
              </fieldset>
            </div>

            {/* Right Column */}
            <div className="flex flex-col space-y-4 sm:space-y-5">
              {/* Full Name */}
              <fieldset className="flex flex-col">
                <label htmlFor="name" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
                  Full Name <span className="text-red-600">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  maxLength={50}
                  className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  aria-required={true}
                />
              </fieldset>

              {/* Phone */}
              <fieldset className="flex flex-col">
                <label htmlFor="phone" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
                  Phone <span className="text-red-600">*</span>
                </label>
                <input
                  id="phone"
                  type="text"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  required
                  maxLength={10}
                  className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  aria-required={true}
                />
              </fieldset>

              {/* Date of Birth */}
              <fieldset className="flex flex-col">
                <label htmlFor="dob" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
                  Date of Birth
                </label>
                <input
                  id="dob"
                  type="date"
                  name="dob"
                  value={formData.dob}
                  onChange={handleChange}
                  className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  aria-required={false}
                />
              </fieldset>

              {/* Profile Image */}
              <fieldset className="flex flex-col">
                <label htmlFor="signup-image-upload" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
                  Profile Image (Optional)
                </label>
                <div className="flex flex-col gap-2">
                  <input
                    id="signup-image-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={handleFileChange}
                    className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                    aria-required={false}
                    aria-invalid={invalidFile}
                  />
                  {previewUrl && (
                    <div className="mt-2">
                      <img src={previewUrl} alt="Preview" className="max-w-[120px] max-h-[120px] rounded-lg object-cover border-2 border-gray-300" />
                    </div>
                  )}
                </div>
              </fieldset>

              {/* Repeat Password */}
              <fieldset className="flex flex-col">
                <label htmlFor="repeatPassword" className="text-sm sm:text-base font-semibold mb-2 text-gray-900">
                  Repeat Password <span className="text-red-600">*</span>
                </label>
                <input
                  id="repeatPassword"
                  type="password"
                  name="repeatPassword"
                  value={formData.repeatPassword}
                  onChange={handleChange}
                  required
                  className="p-3 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                  aria-required={true}
                />
              </fieldset>
            </div>
          </div>
          
          <div className="mt-6 sm:mt-8">
            <ProductButton
              type="submit"
              variant="primary"
              size="lg"
              disabled={isLoading}
              aria-busy={isLoading}
              className="w-full"
            >
              {isLoading ? 'Creating Account...' : 'Create your GASH account'}
            </ProductButton>
          </div>
        </form>

        <p className="text-center text-sm text-gray-600 mt-4 sm:mt-5">
          Already have an account?{' '}
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

export default Register;