import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FaEye, FaEyeSlash, FaHome } from 'react-icons/fa';
import axios from 'axios';
import { encodePayload } from '../utils/encode';
import { toast } from 'react-toastify';
import "./Register.css";
import { Helmet } from 'react-helmet';
import ReCAPTCHA from "react-google-recaptcha";

const iconStyle = { marginRight: '8px', color: 'rgb(236, 108, 29)' };

const Register = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
  });
  const [loading, setLoading] = useState(false); // 🔹 loading state
  const [captchaValue, setCaptchaValue] = useState(null);
  const [isAdult, setIsAdult] = useState(false);
const [termsAccepted, setTermsAccepted] = useState("");
const [showPassword, setShowPassword] = useState(false);

  const API = process.env.REACT_APP_APIURL;
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e) => {
     e.preventDefault();

  if (loading) return;

  setLoading(true);

  if (!captchaValue) {
    toast.error("Please verify captcha");
    setLoading(false);
    return;
  }
  if (!isAdult) {
  toast.error("You must confirm that you are 18 years or older.");
  setLoading(false);
  return;
}

if (termsAccepted !== "accept") {
  toast.error("You must accept the Terms & Conditions to register.");
  setLoading(false);
  return;
}

  try {
      const encoded = encodePayload(formData);
     const res = await axios.post(`${API}/api/auth/register`, {
  payload: encoded,
  captcha: captchaValue
});
      toast.success(res.data.message || 'Registration successful');
      setFormData({ name: '', email: '', phone: '', password: '' });

      // ✅ Redirect to login after toast
      setTimeout(() => {
        navigate('/login');
      }, 1500);
    } catch (err) {
      const message =
        err.response?.data?.message || 'Something went wrong. Please try again.';
      toast.error(message);
    } finally {
      setLoading(false); // always reset
    }
  };

  return (
    <>
      <Helmet>
    <title>Register | Prime Shoes</title>
    <meta
      name="description"
      content="Create your Prime Shoes account to shop the latest footwear, handbags, and accessories. Enjoy easy checkout, order tracking, and exclusive offers."
    />
    <meta
      name="keywords"
      content="Prime Shoes register, create account, sign up, online footwear store, handbags, accessories, Phagwara shopping, Prime Shoes account"
    />
  </Helmet>
    <div className="register-page">
      {/* Breadcrumb */}
      <div className="register-breadcrumb">
        <div className="container">
          <div className="row">
            <div className="col-lg-12">
              <Link to="/"><FaHome style={iconStyle} /> Home</Link>
              <span> / Register</span>
            </div>
          </div>
        </div>
      </div>

      {/* Register Section */}
      <section className="register-section">
        <div className="container register-container">
          <div className="register-card only-form">
            <div className="register-form">
              {/* ✅ Logo same as login */}
              <div className="register-logo">
                <img 
                  src="/img/prime-logo.png" 
                  alt="Prime Shoes Logo" 
                />
              </div>

              <h5>Create Account</h5>
              <form onSubmit={handleSubmit}>
                <input
                  type="text"
                  name="name"
                  placeholder="Full Name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  autoComplete="off"
                />
                <input
                  type="email"
                  name="email"
                  placeholder="Email Address"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  autoComplete="off"
                />
                <input
                  type="text"
                  name="phone"
                  placeholder="Phone Number"
                  value={formData.phone}
                  onChange={handleChange}
                  required
                  autoComplete="off"
                />
                <div className="password-input-wrapper">
  <input
    type={showPassword ? "text" : "password"}
    name="password"
    placeholder="Password"
    value={formData.password}
    onChange={handleChange}
    required
    autoComplete="off"
  />

  <span
    className="password-toggle"
    onClick={() => setShowPassword(!showPassword)}
  >
    {showPassword ? <FaEyeSlash /> : <FaEye />}
  </span>
</div>
                <div style={{ marginBottom: "15px" }}>
  <ReCAPTCHA
    sitekey={process.env.REACT_APP_RECAPTCHA_SITE_KEY}
    onChange={(value) => setCaptchaValue(value)}
  />
</div>
<div className="register-consent-section">

  <label className="register-age-check">
    <input
      type="checkbox"
      checked={isAdult}
      onChange={(e) => setIsAdult(e.target.checked)}
    />
    <span>
      By proceeding, you confirm that you are 18 years or older.
    </span>
  </label>

  <div className="register-terms-box">

<p className="register-terms-text">
  Please read our{" "}
  <Link to="/termsconditions" className="register-link">
    Terms & Conditions
  </Link>{" "}
  and{" "}
  <Link to="/privacypolicy" className="register-link">
    Privacy Policy
  </Link>{" "}
  before proceeding with registration. By continuing, you consent to
  the processing of your personal information for account creation,
  order management, customer support, promotional communications, and
  newsletter subscription in accordance with our policies.
</p>

    <div className="register-radio-group">
      <label>
        <input
          type="radio"
          name="terms"
          value="accept"
          checked={termsAccepted === "accept"}
          onChange={(e) => setTermsAccepted(e.target.value)}
        />
        I Accept
      </label>

      <label>
        <input
          type="radio"
          name="terms"
          value="decline"
          checked={termsAccepted === "decline"}
          onChange={(e) => setTermsAccepted(e.target.value)}
        />
        I Do Not Accept
      </label>
    </div>

  </div>

</div>
                <button 
                  type="submit" 
                  className="register-btn"
                 disabled={
  loading ||
  !isAdult ||
  termsAccepted !== "accept"
}
                >
                  {loading ? 'Registering...' : 'Register'}
                </button>
              </form>

              <p>Already have an account? <Link to="/login">Login here</Link></p>
            </div>
          </div>
        </div>
      </section>
    </div>
    </>
  );
};

export default Register;
