import React, { useEffect, useState } from 'react';
import axios from 'axios';
import Adminsidebar from './Adminsidebar';
import Admintopnav from './Admintopnav';
import { toast } from 'react-toastify';
import { jwtDecode } from 'jwt-decode';
import { decryptToken } from '../utils/securetoken';
import './Adminsales.css';

const Adminsales = () => {
  const [sales, setSales] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterDate, setFilterDate] = useState('');
  const [filterTitle, setFilterTitle] = useState('');
  const [adminName, setAdminName] = useState('Admin User');
  const salesPerPage = 20;
  const API = process.env.REACT_APP_APIURL;

  useEffect(() => {
    const fetchSales = async () => {
      try {
        const res = await axios.get(`${API}/api/admin/orders`);
        setSales(res.data.orders || []);
      } catch {
        toast.error('Failed to fetch sales data');
      }
    };
    fetchSales();
  }, []);

  useEffect(() => {
    const fetchAdminName = async () => {
      try {
        const encryptedToken = sessionStorage.getItem('adminToken');
        if (!encryptedToken) return;
        const decrypted = await decryptToken(encryptedToken);
        const decodedToken = jwtDecode(decrypted);
        setAdminName(decodedToken.adminname || 'Admin User');
      } catch {
        setAdminName('Admin User');
      }
    };
    fetchAdminName();
  }, []);

  const filteredSales = sales.filter((order) => {
    const orderDate = new Date(order.createdAt).toISOString().split('T')[0];
    const matchesDate = filterDate ? orderDate === filterDate : true;
    const matchesProduct = filterTitle
      ? order.items.some((item) =>
          item.title.toLowerCase().includes(filterTitle.toLowerCase())
        )
      : true;
    return matchesDate && matchesProduct;
  });

  const totalPages = Math.ceil(filteredSales.length / salesPerPage);
  const indexOfLastSale = currentPage * salesPerPage;
  const indexOfFirstSale = indexOfLastSale - salesPerPage;
  const currentSales = filteredSales.slice(indexOfFirstSale, indexOfLastSale);

  const handleLogout = () => {
    sessionStorage.removeItem('adminToken');
    toast.success('Logged out');
    window.location.href = '/adminlogin';
  };

  return (
    <div className="admin-layout">
      <Adminsidebar adminName={adminName} handleLogout={handleLogout} />
      <div className="admin-main">
        <Admintopnav adminName={adminName} handleLogout={handleLogout} />

        <div className="sales-container">
          <div className="text-center mb-4">
            <h5 className="admin-users-title">SALES SUMMARY</h5>
          </div>

          {/* Filters */}
          <div className="filter-controls mb-3">
            <label>Date:</label>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => {
                setCurrentPage(1);
                setFilterDate(e.target.value);
              }}
            />
            <label>Product:</label>
<input
  type="text"
  placeholder="Product title"
  value={filterTitle}
  onChange={(e) => {
    setCurrentPage(1);
    setFilterTitle(e.target.value);
  }}
  className="filter-input"
/>
            <button
              onClick={() => {
                setFilterDate('');
                setFilterTitle('');
                setCurrentPage(1);
              }}
              disabled={!filterDate && !filterTitle}
            >
              Clear
            </button>
          </div>

          {/* Sales Table */}
          <div className="sales-table-container">
            {currentSales.length === 0 ? (
              <p className="text-center">No sales to display.</p>
            ) : (
              <table className="sales-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Price (₹)</th>
                    <th>Promo (₹)</th>
                    <th>Delivery (₹)</th>
                    <th>Final (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {currentSales.map((order) =>
                    order.items
                      .filter((item) =>
                        filterTitle
                          ? item.title.toLowerCase().includes(filterTitle.toLowerCase())
                          : true
                      )
                      .map((item, i) => (
                        <tr key={order._id + i} className="order-row">
                          <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                          <td>{item.title}</td>
                          <td>{item.quantity}</td>
                          <td>{item.discountPrice}</td>
                          <td>{order.promoDiscount || 0}</td>
                          <td>{order.deliveryCharge || 0}</td>
                          <td>{order.finalTotal + (order.deliveryCharge || 0)}</td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          {filteredSales.length > salesPerPage && (
            <div className="pagination-container mt-4 mb-4">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i + 1)}
                  className={`pagination-button ${currentPage === i + 1 ? 'active' : ''}`}
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

export default Adminsales;
