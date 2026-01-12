import React, { useState, useEffect, useContext, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../../context/AuthContext";
import { useToast } from "../../hooks/useToast";
import Api from "../../common/SummaryAPI";
import OrderDetailsModal from "../../components/OrderDetails";
import OrderSuccessModal from "../../components/OrderSuccessModal";
import LoadingSpinner, { LoadingSkeleton } from "../../components/LoadingSpinner";
import ProductButton from "../../components/ProductButton";
import { io } from "socket.io-client";
import { SOCKET_URL } from "../../common/axiosClient";

const Orders = () => {
  const { user, isAuthLoading } = useContext(AuthContext);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [vnpayStatus, setVnpayStatus] = useState('pending');
  const [vnpaySuccessInfo, setVnpaySuccessInfo] = useState(null);
  const socketRef = useRef(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5; // Fixed items per page

  const fetchOrders = useCallback(
    async () => {
      if (!user?._id) {
        showToast("No user ID available", "error");
        return;
      }
      setLoading(true);
      try {
        const token = localStorage.getItem("token");
        const response = await Api.order.getOrders(user._id, token);
        const data = response.data.data || [];

        if (!Array.isArray(data)) {
          showToast("Invalid API response format", "error");
          setOrders([]);
          setFilteredOrders([]);
          setLoading(false);
          return;
        }

        const sorted = data.sort(
          (a, b) => new Date(b.orderDate) - new Date(a.orderDate)
        );
        setOrders(sorted);
        setFilteredOrders(sorted);
      } catch (err) {
        setError(err.message);
        showToast("Failed to load orders", "error");
        setOrders([]);
        setFilteredOrders([]);
      } finally {
        setLoading(false);
      }
    },
    [user, showToast]
  );

  useEffect(() => {
    if (!isAuthLoading && user) {
      fetchOrders();
    }
  }, [isAuthLoading, user, fetchOrders]);

  // Handle VNPay return if params are present
  useEffect(() => {
    const params = window.location.search;
    if (params && params.includes('vnp_')) {
      const fetchPaymentResult = async () => {
        try {
          const response = await Api.order.vnpayReturn(params);
          const data = response.data;
          if (data.success && data.data && data.data.code === '00') {
            setVnpayStatus('success');
            setVnpaySuccessInfo({
              status: 'success',
              message: data.message || 'Your order will be promptly prepared and sent to you.!',
              orderId: data.data?.orderId || data.orderId || '',
              amount: data.data?.amount || data.amount || '',
              paymentMethod: data.data?.paymentMethod || 'VNPay',
            });
          } else {
            setVnpayStatus('failed');
            setVnpaySuccessInfo({
              status: 'failed',
              message: data.message || 'Payment failed. Please try again.',
              orderId: data.data?.orderId || data.orderId || '',
              amount: data.data?.amount || data.amount || '',
              paymentMethod: 'VNPay',
            });
          }
        } catch (err) {
          setVnpayStatus('failed');
          setVnpaySuccessInfo({
            status: 'failed',
            message: 'Payment verification failed. Please check your order status.',
            orderId: '',
            amount: '',
            paymentMethod: 'VNPay',
          });
        }
      };
      fetchPaymentResult();
      // Clear the URL params
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [isAuthLoading, user]);

  // Setup Socket.IO for real-time order updates
  useEffect(() => {
    if (!user?._id) return;

    // Initialize socket if not already created
    if (!socketRef.current) {
      const token = localStorage.getItem("token");
      socketRef.current = io(SOCKET_URL, {
        transports: ["websocket", "polling"],
        auth: { token },
        withCredentials: true,
      });
    }

    const socket = socketRef.current;

    // Connect and authenticate
    socket.on("connect", () => {
      // Emit user connection
      socket.emit("userConnected", user._id);
      // Also try authentication if token available
      const token = localStorage.getItem("token");
      if (token) {
        socket.emit("authenticate", token);
      }
    });

    // Listen for order updates
    socket.on("orderUpdated", (payload) => {
      const updatedOrder = payload.order || payload;
      const orderUserId = payload.userId || updatedOrder.acc_id?._id || updatedOrder.acc_id;

      // Only update if this order belongs to the current user
      if (orderUserId && orderUserId.toString() === user._id.toString()) {
        setOrders((prevOrders) => {
          const existingIndex = prevOrders.findIndex((o) => o._id === updatedOrder._id);
          
          if (existingIndex !== -1) {
            // Update existing order while preserving populated orderDetails
            const existingOrder = prevOrders[existingIndex];
            const updated = [...prevOrders];
            
            // Check if updated order has properly populated orderDetails
            const hasPopulatedDetails = updatedOrder.orderDetails?.some(
              (detail) => detail?.variant_id?.productId?.productName
            );
            
            // Preserve existing orderDetails if updated order doesn't have populated ones
            const preservedOrderDetails = hasPopulatedDetails 
              ? updatedOrder.orderDetails 
              : existingOrder.orderDetails;
            
            updated[existingIndex] = {
              ...existingOrder,
              ...updatedOrder,
              // Preserve populated orderDetails structure
              orderDetails: preservedOrderDetails || updatedOrder.orderDetails || existingOrder.orderDetails,
            };
            // Re-sort by orderDate
            return updated.sort(
              (a, b) => new Date(b.orderDate) - new Date(a.orderDate)
            );
          } else {
            // New order - add to beginning
            return [
              updatedOrder,
              ...prevOrders,
            ].sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));
          }
        });

        // Also update filtered orders if applicable
        setFilteredOrders((prevFiltered) => {
          const existingIndex = prevFiltered.findIndex((o) => o._id === updatedOrder._id);
          
          if (existingIndex !== -1) {
            const existingOrder = prevFiltered[existingIndex];
            const updated = [...prevFiltered];
            
            // Check if updated order has properly populated orderDetails
            const hasPopulatedDetails = updatedOrder.orderDetails?.some(
              (detail) => detail?.variant_id?.productId?.productName
            );
            
            // Preserve existing orderDetails if updated order doesn't have populated ones
            const preservedOrderDetails = hasPopulatedDetails 
              ? updatedOrder.orderDetails 
              : existingOrder.orderDetails;
            
            updated[existingIndex] = {
              ...existingOrder,
              ...updatedOrder,
              // Preserve populated orderDetails structure
              orderDetails: preservedOrderDetails || updatedOrder.orderDetails || existingOrder.orderDetails,
            };
            return updated.sort(
              (a, b) => new Date(b.orderDate) - new Date(a.orderDate)
            );
          } else {
            return [
              updatedOrder,
              ...prevFiltered,
            ].sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));
          }
        });

        // Show toast notification for status changes
        if (updatedOrder.order_status) {
          const statusMessages = {
            pending: "Your order is pending",
            confirmed: "Your order has been confirmed",
            shipping: "Your order is on the way!",
            delivered: "Your order has been delivered!",
            cancelled: "Your order has been cancelled",
          };
          const message = statusMessages[updatedOrder.order_status] || "Order status updated";
          showToast(message, "info");
        }
      }
    });

    socket.on("connect_error", (err) => {
      console.error("Orders Socket connection error:", err.message);
    });

    socket.on("disconnect", (reason) => {
      console.warn("⚠️ Orders Socket disconnected:", reason);
    });

    // Cleanup on unmount
    return () => {
      socket.off("connect");
      socket.off("orderUpdated");
      socket.off("connect_error");
      socket.off("disconnect");
      if (socket.connected) {
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [user, showToast]);

  const handleSearchAndFilter = useCallback(() => {
    let filtered = [...orders];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((order) => {
        // Search by Order ID
        if (order._id?.toLowerCase().includes(query)) {
          return true;
        }

        // Search by Order Status
        if (order.order_status?.toLowerCase().includes(query)) {
          return true;
        }

        // Search by Payment Status
        if (order.pay_status?.toLowerCase().includes(query)) {
          return true;
        }

        // Search by Product Name in orderDetails
        if (order.orderDetails && order.orderDetails.length > 0) {
          const hasMatchingProduct = order.orderDetails.some((detail) => {
            const productName = detail.variant_id?.productId?.productName;
            return productName?.toLowerCase().includes(query);
          });
          if (hasMatchingProduct) {
            return true;
          }
        }

        return false;
      });
    }

    setFilteredOrders(filtered);
  }, [orders, searchQuery]);

  useEffect(() => {
    handleSearchAndFilter();
    setCurrentPage(1);
  }, [handleSearchAndFilter]);

  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentOrders = filteredOrders.slice(startIndex, endIndex);

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCloseVNPayModal = () => {
    setVnpaySuccessInfo(null);
    setVnpayStatus('pending');
    // Force fetch orders to update the list
    if (user?._id) {
      fetchOrders();
    }
  };

  const formatDate = (date) =>
    new Date(date).toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  // Format price helper
  const formatPrice = useCallback((price) => {
    if (typeof price !== "number" || isNaN(price)) return "N/A";
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
    }).format(price);
  }, []);

  const getStatusBadge = (status, type = "order") => {
    const base = "inline-flex items-center px-2.5 py-0.5 rounded-sm text-xs font-medium";
    if (type === "order") {
      switch (status?.toLowerCase()) {
        case "pending":
          return (
            <span className={`${base} bg-yellow-100 text-yellow-800`}>
              Pending
            </span>
          );
        case "confirmed":
          return (
            <span className={`${base} bg-blue-100 text-blue-800`}>
              Confirmed
            </span>
          );
        case "shipping":
          return (
            <span className={`${base} bg-indigo-100 text-indigo-800`}>
              Shipping
            </span>
          );
        case "delivered":
          return (
            <span className={`${base} bg-green-100 text-green-800`}>
              Delivered
            </span>
          );
        case "cancelled":
          return (
            <span className={`${base} bg-red-100 text-red-800`}>
              Cancelled
            </span>
          );
        default:
          return (
            <span className={`${base} bg-gray-100 text-gray-800`}>
              Unknown
            </span>
          );
      }
    } else {
      switch (status?.toLowerCase()) {
        case "unpaid":
          return (
            <span className={`${base} bg-orange-100 text-orange-800`}>
              Unpaid
            </span>
          );
        case "paid":
          return (
            <span className={`${base} bg-green-100 text-green-800`}>
              Paid
            </span>
          );
        case "refunded":
          return (
            <span className={`${base} bg-purple-100 text-purple-800`}>
              Refunded
            </span>
          );
        default:
          return (
            <span className={`${base} bg-gray-100 text-gray-800`}>
              Unknown
            </span>
          );
      }
    }
  };

  if (isAuthLoading) {
    return <LoadingSpinner fullScreen text="Loading user data..." />;
  }

  if (!user) {
    navigate("/login");
    return null;
  }

  return (
    <div className="flex flex-col items-center w-full max-w-7xl mx-auto my-3 sm:my-4 md:my-5 p-3 sm:p-4 md:p-5 lg:p-6 text-gray-900">
      <section className="bg-white rounded-xl p-4 sm:p-5 md:p-6 w-full max-w-5xl shadow-sm border border-gray-200">
        <header className="mb-4">
          <h1 className="text-xl sm:text-2xl font-normal mb-2 m-0">My Orders</h1>
          <p className="text-sm text-gray-600 mb-4">
            View and manage your order history. Click on an order to see detailed information.
          </p>
        </header>

        <div className="mb-6 space-y-4">
          <fieldset className="border-2 border-gray-300 rounded-xl p-3 sm:p-4">
            <legend className="text-sm sm:text-base font-semibold m-0">Search</legend>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <div className="flex-1">
                <fieldset className="flex flex-col">
                  <div className="relative">
                    <input
                      id="search-input"
                      type="text"
                      placeholder="Search by product name, order ID, or status..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full p-3 pl-10 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                    />
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <svg
                        className="h-5 w-5 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                        />
                      </svg>
                    </div>
                  </div>
                </fieldset>
              </div>

              {searchQuery && (
                <div className="flex items-end">
                  <ProductButton
                    variant="default"
                    size="md"
                    onClick={() => {
                      setSearchQuery("");
                    }}
                  >
                    Clear
                  </ProductButton>
                </div>
              )}
            </div>
          </fieldset>
        </div>

        <div className="mb-6">
          <p className="text-sm text-gray-600">
            Showing {Math.min(startIndex + 1, filteredOrders.length)}–
            {Math.min(endIndex, filteredOrders.length)} of {filteredOrders.length}{" "}
            orders
          </p>
        </div>

        {loading ? (
          <LoadingSkeleton count={3} />
        ) : filteredOrders.length === 0 ? (
          <div className="text-center text-xs sm:text-sm text-gray-500 border-2 border-gray-300 rounded-xl p-4 sm:p-6 md:p-8 mb-3 sm:mb-4 w-full min-h-[100px] flex flex-col items-center justify-center gap-4" role="status">
            <div className="text-gray-400">
              <svg
                className="w-16 h-16 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            {orders.length === 0 ? (
              <>
                <p className="text-gray-500 italic text-lg">No orders found</p>
                <p className="text-gray-400 text-sm mt-2">
                  Your orders will appear here once you make a purchase
                </p>
              </>
            ) : (
              <>
                <p className="text-gray-500 italic text-lg">
                  No orders match your search
                </p>
                <p className="text-gray-400 text-sm mt-2">
                  Try adjusting your search criteria or filters
                </p>
                <ProductButton
                  variant="default"
                  size="sm"
                  onClick={() => {
                    setSearchQuery("");
                  }}
                  className="text-blue-600"
                >
                  Clear Search
                </ProductButton>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {currentOrders.map((order) => {
              // Get first product from orderDetails
              // Note: getUserOrdersService returns variant_id (not variant) with populated productId
              const firstProduct = order.orderDetails?.[0];
              const productImage = firstProduct?.variant_id?.variantImage || "/placeholder.png";
              const productName = firstProduct?.variant_id?.productId?.productName || "Product (Variant not available)";

              return (
              <article
                key={order._id}
                className="bg-white border-2 border-gray-300 rounded-xl p-4 sm:p-5 mb-4 last:mb-0 flex flex-col sm:flex-row gap-4 transition-shadow hover:shadow-sm border border-gray-200 focus-within:shadow-sm"
                tabIndex={0}
                aria-label={`Order: ${order._id}`}
              >
                <div className="flex items-stretch gap-6 flex-1">
                  {/* Product Image */}
                  {firstProduct && (
                    <img
                      src={productImage}
                      alt={productName}
                      className="w-20 sm:w-24 aspect-square object-cover rounded-lg flex-shrink-0"
                      onError={(e) => {
                        e.target.src = "/placeholder.png";
                      }}
                    />
                  )}
                  
                  {/* Order Details */}
                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base sm:text-lg font-semibold text-gray-900 m-0 line-clamp-2">
                        {productName || "Order"}
                      </p>
                      {order.orderDetails?.length > 1 && (
                        <span className="text-xs sm:text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                          +{order.orderDetails.length - 1} more
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm text-gray-600 m-0">
                        Order #{order._id.slice(-8).toUpperCase()}
                      </p>
                      <span className="text-gray-400">•</span>
                      <p className="text-sm text-gray-600 m-0">
                        {formatDate(order.orderDate)}
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-3 flex-wrap mt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Status:</span>
                        {getStatusBadge(order.order_status, "order")}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-600">Payment:</span>
                        {getStatusBadge(order.pay_status, "pay")}
                      </div>
                    </div>
                    
                    <p className="text-base font-semibold text-red-600 m-0 mt-1">
                      Total: {formatPrice(order.finalPrice)}
                    </p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-row sm:flex-col items-center sm:items-center sm:justify-center gap-3 sm:gap-4">
                  {order.pay_status?.toLowerCase() === "paid" && (
                    <ProductButton
                      variant="default"
                      size="sm"
                      onClick={() => navigate(`/bills/${order._id}`)}
                      className="text-green-600"
                      title="View Bill"
                    >
                      <svg
                        className="w-4 h-4 inline mr-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      View Bill
                    </ProductButton>
                  )}
                  <ProductButton
                    variant="primary"
                    size="sm"
                    onClick={() => setSelectedOrderId(order._id)}
                    title="View Details"
                  >
                    <svg
                      className="w-4 h-4 inline mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                    View Details
                  </ProductButton>
                </div>
              </article>
            );
            })}
          </div>
        )}

        {filteredOrders.length > itemsPerPage && (
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </div>

            <div className="flex items-center gap-2">
              <ProductButton
                variant="default"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Previous
              </ProductButton>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                  const shouldShow =
                    page === 1 ||
                    page === totalPages ||
                    (page >= currentPage - 1 && page <= currentPage + 1);

                  if (!shouldShow) {
                    if (page === currentPage - 2 || page === currentPage + 2) {
                      return (
                        <span key={page} className="px-2 py-1 text-gray-400">
                          ...
                        </span>
                      );
                    }
                    return null;
                  }

                  return (
                    <ProductButton
                      key={page}
                      variant={page === currentPage ? "primary" : "default"}
                      size="sm"
                      onClick={() => handlePageChange(page)}
                    >
                      {page}
                    </ProductButton>
                  );
                })}
              </div>

              <ProductButton
                variant="default"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                Next
                <svg className="w-4 h-4 inline ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </ProductButton>
            </div>
          </div>
        )}
      </section>

      {selectedOrderId && (
        <OrderDetailsModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
        />
      )}

      <OrderSuccessModal open={!!vnpaySuccessInfo} info={{ ...vnpaySuccessInfo, message: undefined }} onClose={handleCloseVNPayModal} />
    </div>
  );
};

export default Orders;