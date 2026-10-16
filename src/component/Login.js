import React, { useState, useContext } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import './Login.css';
import { FaEye, FaEyeSlash, FaHome } from 'react-icons/fa';
import axios from 'axios';

import { encodePayload } from '../utils/encode';
import { encryptToken } from '../utils/securetoken';
import { UserContext } from '../App';
import { toast } from 'react-toastify';
import ReCAPTCHA from "react-google-recaptcha";
import { Helmet } from 'react-helmet';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useContext(UserContext);
const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [loading, setLoading] = useState(false); // 🔹 New loading state
  const [captchaValue, setCaptchaValue] = useState(null);
  

  const API = process.env.REACT_APP_APIURL;

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return; // prevent double click
    setLoading(true);
    if (!captchaValue) {
  toast.error("Please verify captcha");
  setLoading(false);
  return;
}

    try {
      const encoded = encodePayload(formData);
     const res = await axios.post(`${API}/api/auth/login`, {
  payload: encoded,
  captcha: captchaValue
});

      toast.success(res.data.message || 'Login successful');

      const rawToken = atob(res.data.token);
      const encrypted = await encryptToken(rawToken);
      localStorage.setItem('token', encrypted);

      setUser({
        name: res.data.user.name,
        email: res.data.user.email,
        phone: res.data.user.phone,
        usertype: 'user',
      });

      setFormData({ email: '', password: '' });

      const redirectPath = location.state?.from || '/';
      navigate(redirectPath);
    } catch (err) {
      const message =
        err.response?.data?.message || 'Invalid credentials. Please try again.';
      toast.error(message);
    } finally {
      setLoading(false); // always reset
    }
  };

  return (
    <>
    <Helmet>
    <title>Login | Prime Shoes</title>
    <meta
      name="description"
      content="Login to your Prime Shoes account to shop the latest footwear, handbags, and accessories for men, women, and kids. Fast checkout, order tracking, and more."
    />
    <meta
      name="keywords"
      content="Prime Shoes login, user account, sign in, online footwear store, handbags, accessories, Phagwara shopping, Prime Shoes account"
    />
  </Helmet>
    <div className="login-page">
      {/* Breadcrumb */}
      <div className="login-breadcrumb">
        <div className="container">
          <Link to="/">
            <FaHome style={{ marginRight: '8px', color: 'rgb(236, 108, 29)' }} /> 
            Home
          </Link>
          <span> / Login</span>
        </div>
      </div>

      {/* Login Section */}
      <section className="login-section">
        <div className="container login-container">
          <div className="login-card only-form">
            <div className="login-form">
              {/* Logo at top */}
              <div className="login-logo">
                <img 
                  src="/img/prime-logo.png" 
                  alt="Prime Shoes Logo" 
                />
              </div>

              <h5>Login to Your Account</h5>
              <form onSubmit={handleSubmit}>
                <input
                  type="email"
                  name="email"
                  placeholder="Email Address"
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
             <div className="password-input-wrapper">
<div style={{ position: "relative", marginBottom: "15px" }}>
  <input
    type={showPassword ? "text" : "password"}
    name="password"
    placeholder="Password"
    value={formData.password}
    onChange={handleChange}
    required
    autoComplete="off"
    style={{
      width: "100%",
      padding: "12px 45px 12px 12px",
      border: "1px solid #ddd",
      height: "48px",
      boxSizing: "border-box",
    }}
  />

  <button
    type="button"
    onClick={() => setShowPassword(!showPassword)}
    style={{
      position: "absolute",
      right: "12px",
      top: "50%",
      transform: "translateY(-50%)",
      background: "transparent",
      border: "none",
      cursor: "pointer",
      padding: 0,
      display: "flex",
      alignItems: "center",
    }}
  >
    {showPassword ? <FaEyeSlash /> : <FaEye />}
  </button>
</div>
</div>
                <div style={{ marginTop: "15px", marginBottom: "15px" }}>
  <ReCAPTCHA
    sitekey={process.env.REACT_APP_RECAPTCHA_SITE_KEY}
    onChange={(value) => setCaptchaValue(value)}
  />
</div>
                <button 
                  type="submit" 
                  className="login-btn" 
                  disabled={loading} // 🔹 disable when loading
                >
                  {loading ? 'Logging in...' : 'Login'}
                </button>
                <p className="login-privacy-note">
  By logging in, you agree to our{" "}
  <Link to="/termsconditions">Terms & Conditions</Link>{" "}
  and{" "}
  <Link to="/privacypolicy">Privacy Policy</Link>.
</p>
              </form>
              <p>
                Don’t have an account? <Link to="/register">Register here</Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
    </>
  );
};

export default Login;
