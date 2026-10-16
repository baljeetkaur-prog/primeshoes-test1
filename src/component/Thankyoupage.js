import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaHome, FaCheckCircle } from "react-icons/fa";
import { Helmet } from "react-helmet";

const Thankyoupage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const orderNumber = location.state?.orderNumber;

  return (
    <>
     <Helmet>
   <title>Thank You for Your Order – Prime Shoes Phagwara | View Your Order Details</title>
    <meta
      name="description"
      content="Thank you for your order at Prime Shoes. Your order has been successfully placed. View your order details in My Orders."
    />
    <meta
      name="keywords"
      content="Prime Shoes thank you, order confirmation, order placed, shopping confirmation, my orders, online footwear shopping, accessories purchase"
    />
  </Helmet>
    <div className="login-page">
      {/* Breadcrumb */}
      <div className="login-breadcrumb">
        <div className="container">
          <a href="/" className="text-decoration-none">
            <FaHome style={{ marginRight: "8px", color: "rgb(236,108,29)" }} /> 
            Home
          </a>
          <span> / Thank You</span>
        </div>
      </div>

      {/* Thank You Section */}
      <section className="login-section">
        <div className="container login-container">
          <div className="login-card only-form text-center" style={{ padding: "40px 30px" }}>
            
            {/* Logo */}
            <div className="login-logo mb-3">
              <img src="/img/prime-logo.png" alt="Prime Shoes Logo" />
            </div>

            {/* Success Icon */}
            <div
              style={{
                backgroundColor: "#e7fbe9",
                width: "70px",
                height: "70px",
                margin: "0 auto 20px auto",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 0 6px #d0f0d4",
              }}
            >
              <FaCheckCircle size={38} style={{ color: "#28a745" }} />
            </div>

            <h5 style={{ marginBottom: "15px", fontWeight: "600", color: "#000" }}>
              Thank You for Your Order
            </h5>

            {orderNumber && (
              <p style={{ marginBottom: "15px", color: "#444" }}>
                We’ve received your order.<br />
                <span style={{ fontWeight: "600" }}>Order #{orderNumber}</span>
              </p>
            )}

            <p style={{ marginBottom: "25px", color: "#777" }}>
              You can view the details in <strong>My Orders</strong>.
            </p>

            {/* CTA Button */}
            <button
              onClick={() => navigate("/orders")}
              className="login-btn"
              style={{
                backgroundColor: "rgb(236,108,29)",
                color: "#fff",
                border: "none",
                padding: "10px 24px",
                fontSize: "15px",
                fontWeight: "500",
                borderRadius: "25px",
                boxShadow: "0 5px 12px rgba(202, 21, 21, 0.2)",
                transition: "all 0.3s ease",
              }}
            >
              View My Orders
            </button>
          </div>
        </div>
      </section>
    </div>
    </>
  );
};

export default Thankyoupage;
