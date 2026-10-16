import React, { useEffect, useState, useContext } from 'react';
import { FaHome, FaBoxOpen, FaInfoCircle } from 'react-icons/fa';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Instagram from './Instagram';
import { UserContext } from '../App';
import './Orders.css'; // custom CSS for responsiveness
import { toast } from 'react-toastify';
import ReturnCancelModal from './Returncancelmodal';
import { Helmet } from 'react-helmet';

const badgeStyle = {
  padding: '4px 12px',
  borderRadius: '12px',
  fontSize: '12px',
  fontWeight: '600',
  textTransform: 'capitalize',
};
    const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return isMobile;
}

const Orders = () => {
  const { user } = useContext(UserContext);
  const [orders, setOrders] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const ordersPerPage = 10;
  const API = process.env.REACT_APP_APIURL;
   const isMobile = useIsMobile();
   const [modalOpen, setModalOpen] = useState(false);
const [modalType, setModalType] = useState(null); 
const [activeOrder, setActiveOrder] = useState({ 
  orderId: null, 
  variantId: null,     // ← Changed from productId
  paymentMode: null   
});
const getDeliveredDate = (order, item) => {
  if (item.status !== 'Delivered') return null;

  const created = new Date(order.createdAt);

  // If the order is marked Delivered, assume delivery happened at most 7 days after creation
  // We'll use today's date if order is already delivered
  const today = new Date();
  const maxDeliveryDate = new Date(created);
  maxDeliveryDate.setDate(created.getDate() + 7);

  // Delivery cannot be in the future
  return today < maxDeliveryDate ? today : maxDeliveryDate;
};
const openModal = (orderId, variantId, type, paymentMode) => {   // ← Added variantId
  setActiveOrder({ orderId, variantId, paymentMode });
  setModalType(type);
  setModalOpen(true);
};


const handleModalSubmit = async (reason, bankDetails = null) => {
  try {
    let url = '';
    let payload = { 
      reason, 
      variantId: activeOrder.variantId   // ← Changed from productId
    };

    // Add bank details only for COD returns
    if (modalType === 'return' && activeOrder.paymentMode === 'cod' && bankDetails) {
      payload.bankDetails = bankDetails;
    }

    if (modalType === 'cancel') {
      url = `${API}/api/cancel/${activeOrder.orderId}`;
    } else if (modalType === 'return') {
      url = `${API}/api/return/${activeOrder.orderId}`;
    }

    const res = await axios.post(url, payload);

    toast.success(res.data.message);
    
    const freshOrders = await axios.get(`${API}/api/uorders/${user?.email}`);
    setOrders(freshOrders.data.orders || []);
    
  } catch (err) {
    toast.error(err.response?.data?.message || "Action failed");
  } finally {
    setModalOpen(false);
  }
};



  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await axios.get(`${API}/api/uorders/${user?.email}`);
        setOrders(res.data.orders || []);
      } catch (err) {
        toast.error("Failed to fetch your orders.");
      }
    };

    if (user?.email) fetchOrders();
  }, [user]);

  const indexOfLastOrder = currentPage * ordersPerPage;
  const indexOfFirstOrder = indexOfLastOrder - ordersPerPage;
  const currentOrders = orders.slice(indexOfFirstOrder, indexOfLastOrder);
  const totalPages = Math.ceil(orders.length / ordersPerPage);
const isSameDay = (createdAt) => {
  const today = new Date();
  const createdDate = new Date(createdAt);
  return (
    today.getFullYear() === createdDate.getFullYear() &&
    today.getMonth() === createdDate.getMonth() &&
    today.getDate() === createdDate.getDate()
  );
};
const isWithinReturnPeriod = (deliveredAt, days = 5) => {
  if (!deliveredAt) return false;

  const deliveryDate = new Date(deliveredAt);
  const today = new Date();

  // Convert both to UTC midnight for accurate day difference
  const deliveryUTC = Date.UTC(deliveryDate.getFullYear(), deliveryDate.getMonth(), deliveryDate.getDate());
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  const diffTime = todayUTC - deliveryUTC; // in ms
  const diffDays = diffTime / (1000 * 60 * 60 * 24);

  return diffDays >= 0 && diffDays <= days;
};


const handleCancel = async (orderId) => {
  const reason = prompt("Please provide a reason for cancellation:");
  if (!reason) return;

  try {
    const res = await axios.post(`${API}/api/cancel/${orderId}`, { reason });
    toast.success(res.data.message);
    window.location.reload(); // refresh orders
  } catch (err) {
    toast.error(err.response?.data || "Cancellation failed");
  }
};

const handleReturn = async (orderId) => {
  const reason = prompt("Please provide a reason for return:");
  if (!reason) return;

  try {
    const res = await axios.post(`${API}/api/return/${orderId}`, { reason });
    toast.success(res.data.message);
    window.location.reload(); // refresh orders
  } catch (err) {
    toast.error(err.response?.data || "Return failed");
  }
};



  return (
    <>
      <Helmet>
    <title>My Orders | Prime Shoes</title>
    <meta
      name="description"
      content="View all your orders at Prime Shoes. Track your order status, return or cancel items within the allowed period, and manage your purchases easily."
    />
    <meta
      name="keywords"
      content="Prime Shoes my orders, order tracking, order status, cancel order, return order, online shopping orders, footwear orders, ecommerce orders"
    />
  </Helmet>
    <div>

      {/* Breadcrumb */}
      <div className="custom-breadcrumb">
        <div className="breadcrumb-container">
          <div className="breadcrumb-links">
            <Link to="/"><i className="fa fa-home"></i> Home</Link>
            <span>My Orders</span>
          </div>
        </div>
      </div>


      {/* Orders Section */}
         <section className="contact spad" style={{borderBottom: '1px solid #000'}}>
        <div className="container">
          <div className="row">
            <div className="col-lg-12">
              <h5 className="mb-4" style={{textAlign:'center', color: '#111111', fontWeight: '600', textTransform: 'uppercase', fontSize: '20px'}}>Your Orders</h5><br/>

              {orders.length === 0 ? (
                <p>You have not placed any orders yet.</p>
              ) : (
                <>
                  {!isMobile ? (
                    // Table view for desktop
                    <div className="full-width-table-wrapper">
    <div className="responsive-table-wrapper">
      <table className="table table-bordered align-middle orders-table">
    <thead>
      <tr style={{ textAlign: 'center' }}>
        <th>Order No</th>
        <th>Date</th>
        <th>Products</th>
        <th>Qty</th>
        <th>Total Paid</th>
        <th>Payment</th>
        <th>Status</th>
        <th>Shipping Address</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody>
      {currentOrders.map((order) =>
        order.items.map((item, itemIndex) => (
          
          <tr key={`${order._id}-${itemIndex}`} style={{ verticalAlign: 'middle' }}>
            <td className="text-center fw-bold">
              ORD-{order._id.slice(-6).toUpperCase()}
            </td>
            <td className="text-center">
              {new Date(order.createdAt).toLocaleDateString()}
            </td>
            <td>
              <div className="d-flex align-items-center flex-md-row flex-column text-start order-product-info">
          {item.productId?.mainImage && (
  <img
    src={
      item.productId?.mainImage?.url
        ? item.productId.mainImage.url    // Cloudinary URL
        : `/uploads/${item.productId.mainImage}` // Local upload
    }
    alt="Product"
    width="60"
    height="60"
    className="rounded mb-2 mb-md-0"
    style={{ objectFit: 'cover' }}
  />
)}
                <div className="ms-md-3">
                  <div className="fw-bold">{item.productId?.title || item.title}</div>
                  <div className="text-muted" style={{ fontSize: '12px' }}>
                    {item.variant?.size && <>Size: {item.variant?.size} </>}
                    {item.variant?.color && <>| Color: {item.variant?.color}</>}
                  </div>
                </div>
              </div>
            </td>
            <td className="text-center">{item.quantity}</td>
<td style={{ lineHeight: '1.6', fontSize: '13px' }}>
 <div><b>MRP:</b> ₹{item.originalPrice} × {item.quantity} = ₹{item.originalPrice * item.quantity}</div>
  <div><b>After Product Discount:</b> ₹{item.discountPrice} × {item.quantity} = ₹{item.discountPrice * item.quantity}</div>
{(() => {
  let parsedCoupon = null;
  try {
    parsedCoupon = typeof item.coupon === 'string' ? eval('(' + item.coupon + ')') : item.coupon;
  } catch (err) {
    parsedCoupon = null;
  }

  if (parsedCoupon?.amount > 0) {
    const discount = Math.round((item.discountPrice * parsedCoupon.amount) / 100) * item.quantity;
    return (
      <div>
        <b>Promo Discount:</b> ₹{discount}
      </div>
    );
  }
  return null;
})()}


  {order.deliveryCharge > 0 && (
  <div>
    <b>Delivery:</b> ₹
    {(() => {
      const totalItems = order.items.reduce((acc, itm) => acc + itm.quantity, 0);
      return Math.round((order.deliveryCharge / totalItems) * item.quantity);
    })()}
  </div>
)}

 <div style={{ marginTop: '4px' }}>
  <b>Final Paid:</b> ₹
  {(() => {
    const base = item.discountPrice * item.quantity;

    let parsedCoupon = null;
    try {
      parsedCoupon = typeof item.coupon === 'string' ? eval('(' + item.coupon + ')') : item.coupon;
    } catch (err) {
      parsedCoupon = null;
    }

    const promo = parsedCoupon?.amount
      ? Math.round((item.discountPrice * parsedCoupon.amount) / 100) * item.quantity
      : 0;

    const totalItems = order.items.reduce((acc, itm) => acc + itm.quantity, 0);
    const itemDelivery = order.deliveryCharge
      ? Math.round((order.deliveryCharge / totalItems) * item.quantity)
      : 0;

    return base - promo + itemDelivery;
  })()}
</div>

</td>


            <td className="text-center">{order.paymentMode}</td>
            <td className="text-center">
           <div style={{ fontSize: '12px', marginTop: '4px' }}>
<span
  className={`status-badge ${
    (item.status || order.status || 'Pending').toLowerCase()
  }`}
>
  {item.status || order.status || 'Pending'}
</span>
</div>


            </td>
            <td style={{ fontSize: '13px' }}>
              <div>{order.billing.firstName} {order.billing.lastName}</div>
              <div>{order.billing.phone}</div>
              <div>{order.billing.addressLine1}</div>
              {order.billing.addressLine2 && <div>{order.billing.addressLine2}</div>}
              <div>{order.billing.city}, {order.billing.state}</div>
              <div>{order.billing.zip}</div>
            </td>
            <td className="text-center">
{item.status === 'Delivered' ? (
  <>
    <Link to={`/rate/${item.productId?._id}`} className="rate-btn-table">Rate</Link>
{item.status === 'Delivered' &&
  isWithinReturnPeriod(getDeliveredDate(order, item), 5) && // 5 days return period
  !item.isReturned && (
<button
  className="return-btn-table"
  onClick={() => openModal(order._id, item.variantId, 'return', order.paymentMode)}   // ← variantId
>
  Return
</button>
)}





  </>
) : (
  <>
    <button className="rate-btn-table disabled" onClick={() => toast.info("Please wait until delivery to rate.")}>
      Rate
    </button>
{item.status !== 'Cancelled' ? (
  isSameDay(order.createdAt) && (
    <button
      className="cancel-btn-table"
      onClick={() =>
        openModal(order._id, item.variantId, 'cancel', order.paymentMode)
      }
    >
      Cancel
    </button>
  )
) : (
  <span style={{ color: '#999', fontSize: '12px' }}>
    Cancelled
  </span>
)}
  </>
)}


{(order.status === 'Delivered' || isSameDay(order.createdAt)) && (
  <p style={{ fontSize: '11px', color: '#888', marginTop: '6px' }}>
    Note: Delivery charge is refunded only for damaged or wrong items.
  </p>
)}


            </td>
          </tr>
        ))
      )}
    </tbody>
  </table>
</div>
</div>

                  ) : (
                    // Card view for mobile
                    <>
                      {currentOrders.map((order) =>
                        order.items.map((item, itemIndex) => (
                          <div key={`${order._id}-${itemIndex}`} className="order-card">
                            <div className="order-card-header">
                              Order: ORD-{order._id.slice(-6).toUpperCase()}
                            </div>
                            <div>Date: {new Date(order.createdAt).toLocaleDateString()}</div>
                            <div className="order-card-product">
                             <img
  src={
    item.productId?.mainImage?.url
      ? item.productId.mainImage.url   // Cloudinary URL
      : `/uploads/${item.productId?.mainImage}` // Local upload
  }
  alt="Product"
/>

                              <div className="order-card-product-details">
                                <div><b>{item.productId?.title || item.title}</b></div>
                                
                                <div className="text-muted" style={{ fontSize: '12px' }}>
                                {item.variant?.size && (
  <div style={{ fontSize: '12px' }}>
    Size: {item.variant.size}
  </div>
)}

{item.variant?.color && (
  <div style={{ fontSize: '12px' }}>
    Color: {item.variant.color}
  </div>
)}
                                </div>
                                <div>Qty: {item.quantity}</div>
                              </div>
                            </div>
                            <div className="order-card-footer">
                              <div><b>MRP:</b> ₹{item.originalPrice} × {item.quantity} = ₹{item.originalPrice * item.quantity}</div>
  <div><b>After Product Discount:</b> ₹{item.discountPrice} × {item.quantity} = ₹{item.discountPrice * item.quantity}</div>

  {(() => {
    let parsedCoupon = null;
    try {
      parsedCoupon = typeof item.coupon === 'string' ? eval('(' + item.coupon + ')') : item.coupon;
    } catch (err) {
      parsedCoupon = null;
    }

    if (parsedCoupon?.amount > 0) {
      const discount = Math.round((item.discountPrice * parsedCoupon.amount) / 100) * item.quantity;
      return <div><b>Promo Discount:</b> ₹{discount}</div>;
    }
    return null;
  })()}

  {order.deliveryCharge > 0 && (
    <div>
      <b>Delivery:</b> ₹
      {(() => {
        const totalItems = order.items.reduce((acc, itm) => acc + itm.quantity, 0);
        return Math.round((order.deliveryCharge / totalItems) * item.quantity);
      })()}
    </div>
  )}

  <div><b>Final Paid:</b> ₹
    {(() => {
      const base = item.discountPrice * item.quantity;

      let parsedCoupon = null;
      try {
        parsedCoupon = typeof item.coupon === 'string' ? eval('(' + item.coupon + ')') : item.coupon;
      } catch (err) {
        parsedCoupon = null;
      }

      const promo = parsedCoupon?.amount
        ? Math.round((item.discountPrice * parsedCoupon.amount) / 100) * item.quantity
        : 0;

      const totalItems = order.items.reduce((acc, itm) => acc + itm.quantity, 0);
      const itemDelivery = order.deliveryCharge
        ? Math.round((order.deliveryCharge / totalItems) * item.quantity)
        : 0;

      return base - promo + itemDelivery;
    })()}
  </div>
                              <div>Payment Mode: {order.paymentMode}</div>
                              <div className="order-card-status">
<span
  style={{
    ...badgeStyle,
    background:
      item.status === 'Cancelled'
        ? '#999'
        : item.status === 'Returned'
        ? '#f39c12'
        : item.status === 'Delivered'
        ? '#28a745' // green for delivered
        : '#000', // default
  }}
>
  {item.status || order.status || 'Pending'}
</span>
    </div>

                              <div><b>Ship To:</b> {order.billing.firstName} {order.billing.lastName}, {order.billing.addressLine1}, {order.billing.city}</div>
{item.status === 'Delivered' ? (
  <>
    <Link to={`/rate/${item.productId?._id}`} className="rate-btn-mobile">Rate</Link>
{item.status === 'Delivered' && (
  <>
    {item.returnStatus === 'ReturnRequested' && (
      <span style={{ color: '#f39c12', fontSize: '12px' }}>
        Return Requested
      </span>
    )}

    {item.returnStatus === 'ReturnApproved' && (
      <span style={{ color: '#3498db', fontSize: '12px' }}>
        Return Approved
      </span>
    )}

    {item.returnStatus === 'Returned' && (
      <span style={{ color: '#28a745', fontSize: '12px' }}>
        Returned
      </span>
    )}

    {!item.returnStatus &&
      isWithinReturnPeriod(getDeliveredDate(order, item), 5) && (
        <button
          className="return-btn-table"
          onClick={() =>
            openModal(order._id, item.variantId, 'return', order.paymentMode)
          }
        >
          Return
        </button>
      )}
  </>
)}




  </>
) : (
  <>
    <button
      className="rate-btn-mobile disabled"
      onClick={() => toast.info("Please wait until delivery to rate.")}
    >
      Rate
    </button>
    {isSameDay(order.createdAt) && !order.isCancelled && (
 <button
  className="cancel-btn-mobile"
  onClick={() => openModal(order._id, item.variantId, 'cancel', order.paymentMode)}   // ← variantId
>
  Cancel
</button>
    )}
  </>
)}


{(order.status === 'Delivered' || isSameDay(order.createdAt)) && (
  <p style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
    *Delivery charges refunded only for damaged/wrong products.
  </p>
)}



                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}

                  {/* Pagination */}
                  {orders.length > ordersPerPage && (
                    <div className="product__pagination text-center mt-4">
                      {[...Array(totalPages)].map((_, i) => (
                        <button
                          key={i}
                          className={`pagination-btn ${currentPage === i + 1 ? 'active' : ''}`}
                          style={{
                            border: 'none',
                            padding: '8px 14px',
                            margin: '0 4px',
                            borderRadius: '50%',
                            background: currentPage === i + 1 ? 'rgb(236, 108, 29)' : '#f0f0f0',
                            color: currentPage === i + 1 ? '#fff' : '#111',
                            cursor: 'pointer',
                          }}
                          onClick={() => setCurrentPage(i + 1)}
                        >
                          {i + 1}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
<div className="order-notes">
    <h6 className="order-notes-title">
      <FaInfoCircle className="order-notes-icon" />
      Important Notes
    </h6>
    <ul className="order-notes-list">
      <li><span>*</span> Shipping Time: 0 to 7 days</li>
      <li><span>*</span> Refund Time: 3 to 5 days</li>
      <li><span>*</span> Cancellation: Only allowed on the same day of order</li>
      <li><span>*</span> Delivery charges are refunded only for damaged or wrong products</li>
    </ul>
  </div>



      </section>
<ReturnCancelModal
  isOpen={modalOpen}
  type={modalType}
  paymentMode={activeOrder.paymentMode}    
  onClose={() => setModalOpen(false)}
  onSubmit={handleModalSubmit}
/>

    </div>
    </>
  );
};

export default Orders;
