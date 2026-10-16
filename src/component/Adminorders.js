import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import './Adminorders.css';
import Adminsidebar from './Adminsidebar';
import Admintopnav from './Admintopnav';
import { jwtDecode } from 'jwt-decode';
import { decryptToken } from '../utils/securetoken';

const Adminorders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adminName, setAdminName] = useState("Admin User");
  const [currentPage, setCurrentPage] = useState(1);
  const [filterDate, setFilterDate] = useState('');
  const [expandedOrders, setExpandedOrders] = useState({});
  const API = process.env.REACT_APP_APIURL;
  const ordersPerPage = 20;

  // Fetch Orders
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await axios.get(`${API}/api/admin/orders`);
        setOrders(res.data.orders || []);
      } catch (err) {
        toast.error('Failed to fetch orders');
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, [API]);

  // Decode Admin Name
  useEffect(() => {
    const getAdminName = async () => {
      const encrypted = sessionStorage.getItem('adminToken');
      if (!encrypted) return;
      const decrypted = await decryptToken(encrypted);
      if (!decrypted) return;
      try {
        const decoded = jwtDecode(decrypted);
        setAdminName(decoded.adminname || "Admin User");
      } catch (err) {
        console.error("Invalid token");
      }
    };
    getAdminName();
  }, []);

  // Filtering + Pagination
  const filteredOrders = filterDate
    ? orders.filter(order =>
        new Date(order.createdAt).toISOString().slice(0, 10) === filterDate
      )
    : orders;

  const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);
  const indexOfLastOrder = currentPage * ordersPerPage;
  const indexOfFirstOrder = indexOfLastOrder - ordersPerPage;
  const currentOrders = filteredOrders.slice(indexOfFirstOrder, indexOfLastOrder);

  const handleLogout = () => {
    sessionStorage.removeItem('adminToken');
    toast.success("Logged out");
    window.location.href = "/adminlogin";
  };

  const toggleOrderExpansion = (orderId) => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  if (loading) {
    return (
      <div className="admin-layout">
        <Adminsidebar adminName={adminName} handleLogout={handleLogout} />
        <div className="admin-main">
          <Admintopnav adminName={adminName} handleLogout={handleLogout} />
          <div className="orders-container text-center p-5">
            <p>Loading orders...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-layout">
      <Adminsidebar adminName={adminName} handleLogout={handleLogout} />
      <div className="admin-main">
        <Admintopnav adminName={adminName} handleLogout={handleLogout} />

        <div className="orders-container">
          <div className="text-center mb-4">
            <h5 className="admin-users-title">ALL ORDERS</h5>
          </div>

          {/* Date Filter */}
          <div className="date-filter mb-3 d-flex align-items-center gap-2">
            <label htmlFor="filterDate">Filter by Date:</label>
            <input
              type="date"
              id="filterDate"
              value={filterDate}
              onChange={(e) => {
                setCurrentPage(1);
                setFilterDate(e.target.value);
              }}
            />
            <button
              onClick={() => {
                setCurrentPage(1);
                setFilterDate('');
              }}
              disabled={!filterDate}
            >
              Clear
            </button>
          </div>

          {/* ---------------- Table for Large Screens ---------------- */}
          {currentOrders.length > 0 && (
           <div className="orders-table-container">
              <table className="orders-table">
       
<thead>
  <tr>
    <th></th>
    <th>Order No</th>
    <th>Date</th>
    <th>Customer</th>
    <th>Amount</th>
    <th>Payment</th>
    <th>Order Status</th>
    <th>Shipping Status</th>
    <th>Delivery</th>
  </tr>
</thead>

                <tbody>
                  {currentOrders.map((order) => (
                    <React.Fragment key={order._id}>
                      <tr className="order-row">
                        <td>
                          <button
                            className="expand-btn"
                            onClick={() => toggleOrderExpansion(order._id)}
                          >
                            {expandedOrders[order._id] ? "▼" : "▶"}
                          </button>
                        </td>
                        <td>#{order.orderNumber}</td>
                        <td>{new Date(order.createdAt).toLocaleString()}</td>
                        <td>{order.email}<br /><small>{order.billing?.phone}</small></td>
                        <td>₹{order.finalTotal + (order.deliveryCharge || 0)}</td>
                        <td>
                          {order.paymentMode?.toUpperCase()} <br />
                          {order.isPaid ? <span className="paid">Paid</span> : <span className="unpaid">Unpaid</span>}
                        </td>
                        
<td>
  <span className={`order-status-badge ${(
    order.status || "Pending"
  ).toLowerCase().replace(/\s+/g, "-")}`}>
    {order.status || "Pending"}
  </span>
</td>

<td>
  <span className={`shipping-status-badge ${(
    order.shippingStatus || "Pending"
  ).toLowerCase().replace(/\s+/g, "-")}`}>
    {order.shippingStatus || "Pending"}
  </span>
</td>

                        <td>{order.deliveryCharge > 0 ? `₹${order.deliveryCharge}` : <span className="free-delivery">Free</span>}</td>
                      </tr>

                      {expandedOrders[order._id] && (
                        <tr className="order-items-row">
                       <td colSpan="9">
                            <div className="order-items">
                              {order.items.map((item, i) => (
                                <div key={i} className="order-item">
                                  {item.productId?.mainImage && (
                                    <img
                                      src={item.productId?.mainImage?.url || `/uploads/${item.productId.mainImage}`}
                                      alt={item.title}
                                      className="item-img"
                                    />
                                  )}
                                  <div className="item-details">
                                    <p className="item-title">{item.title} (x{item.quantity})</p>
                                    <p>₹{item.discountPrice}</p>
                                    {item.color && <p>Color: {item.color}</p>}
                                    {item.size && <p>Size: {item.size}</p>}
                                    {item.coupon?.code && <p className="text-success">Coupon: {item.coupon.code} ({item.coupon.amount}% off)</p>}
                                  </div>
                                  <div className="item-status">
                                    <select
                                      value={item.status}
                                      disabled={item.isCancelled || item.isReturned}
                                      onChange={async (e) => {
                                        const newStatus = e.target.value;
                                        try {
                                          await axios.put(`${API}/api/orders/${order._id}/item/${i}/status`, { status: newStatus });
                                          toast.success("Item status updated");
                                          setOrders((prev) =>
                                            prev.map((o) =>
                                              o._id === order._id
                                                ? { ...o, items: o.items.map((itm, idx) => idx === i ? { ...itm, status: newStatus } : itm) }
                                                : o
                                            )
                                          );
                                        } catch (err) {
                                          toast.error("Failed to update item status");
                                        }
                                      }}
                                    >
                               <option value="Pending">Pending</option>
<option value="Confirmed">Confirmed</option>
<option value="Shipped">Shipped</option>
<option value="Delivered">Delivered</option>
                                    </select>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ---------------- Cards for Small Screens ---------------- */}
          <div className="order-cards-container">
            {currentOrders.length === 0 ? (
              <p className="text-center">No orders found.</p>
            ) : (
              currentOrders.map(order => (
                <div className="order-card" key={order._id}>
                  <div className="order-card-header">
                    <span>Order #{order.orderNumber}</span>
                    <span>
                      <button
                        className="expand-btn"
                        onClick={() => toggleOrderExpansion(order._id)}
                      >
                        {expandedOrders[order._id] ? "▼" : "▶"}
                      </button>
                    </span>
                  </div>
                  <div className="order-card-body">
                    <div><strong>Date:</strong> {new Date(order.createdAt).toLocaleString()}</div>
                    <div><strong>Customer:</strong> {order.email}, {order.billing?.phone}</div>
                    <div><strong>Amount:</strong> ₹{order.finalTotal + (order.deliveryCharge || 0)}</div>
                    <div><strong>Payment:</strong> {order.paymentMode?.toUpperCase()} - {order.isPaid ? <span className="paid">Paid</span> : <span className="unpaid">Unpaid</span>}</div>
                    
<div>
  <strong>Order Status:</strong>{" "}
  <span className={`order-status-badge ${(
    order.status || "Pending"
  ).toLowerCase().replace(/\s+/g, "-")}`}>
    {order.status || "Pending"}
  </span>
</div>

<div>
  <strong>Shipping:</strong>{" "}
  <span className={`shipping-status-badge ${(
    order.shippingStatus || "Pending"
  ).toLowerCase().replace(/\s+/g, "-")}`}>
    {order.shippingStatus || "Pending"}
  </span>
</div>

                    <div><strong>Delivery:</strong> {order.deliveryCharge > 0 ? `₹${order.deliveryCharge}` : <span className="free-delivery">Free</span>}</div>

                    {expandedOrders[order._id] && (
                      <div className="order-items mt-2">
                        {order.items.map((item, i) => (
                          <div className="order-card-item" key={i}>
                            {item.productId?.mainImage && (
                              <img src={item.productId?.mainImage?.url || `/uploads/${item.productId.mainImage}`} alt={item.title} />
                            )}
                            <div className="order-card-item-details">
                              <p>{item.title} (x{item.quantity})</p>
                              <p>₹{item.discountPrice}</p>
                              {item.color && <p>Color: {item.color}</p>}
                              {item.size && <p>Size: {item.size}</p>}
                              {item.coupon?.code && <p className="text-success">Coupon: {item.coupon.code} ({item.coupon.amount}% off)</p>}
                            </div>
                            <div className="item-status">
                              <select
                                value={item.status}
                                disabled={item.isCancelled || item.isReturned}
                                onChange={async (e) => {
                                  const newStatus = e.target.value;
                                  try {
                                    await axios.put(`${API}/api/orders/${order._id}/item/${i}/status`, { status: newStatus });
                                    toast.success("Item status updated");
                                    setOrders((prev) =>
                                      prev.map((o) =>
                                        o._id === order._id
                                          ? { ...o, items: o.items.map((itm, idx) => idx === i ? { ...itm, status: newStatus } : itm) }
                                          : o
                                      )
                                    );
                                  } catch (err) {
                                    toast.error("Failed to update item status");
                                  }
                                }}
                              >
                         <option value="Pending">Pending</option>
<option value="Confirmed">Confirmed</option>
<option value="Shipped">Shipped</option>
<option value="Delivered">Delivered</option>
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ---------------- Pagination ---------------- */}
          {filteredOrders.length > ordersPerPage && (
            <div className="pagination-container text-center mt-4 mb-4">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i + 1)}
                  className={`pagination-button ${currentPage === i + 1 ? "active" : ""}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default Adminorders;
