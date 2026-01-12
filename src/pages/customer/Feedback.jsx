import React, { useState, useEffect, useContext, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../../context/AuthContext";
import { useToast } from "../../hooks/useToast";
import Api from "../../common/SummaryAPI";
import FeedbackDetailsModal from "../../components/FeedbackDetailsModal";
import LoadingSpinner, { LoadingSkeleton } from "../../components/LoadingSpinner";
import ProductButton from "../../components/ProductButton";

const Feedback = () => {
  const { user, isAuthLoading } = useContext(AuthContext);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [feedbacks, setFeedbacks] = useState([]);
  const [filteredFeedbacks, setFilteredFeedbacks] = useState([]);
  const [eligibleItems, setEligibleItems] = useState([]);
  const [filteredEligibleItems, setFilteredEligibleItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFeedback, setSelectedFeedback] = useState(null);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [showEligibleOnly, setShowEligibleOnly] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Extract feedbacks from orders
  const extractFeedbacksFromOrders = useCallback((orders) => {
    const feedbackList = [];

    orders.forEach((order) => {
      if (order.orderDetails && Array.isArray(order.orderDetails)) {
        order.orderDetails.forEach((detail, index) => {
          // Check for feedback in multiple possible locations
          const feedback = detail.feedback || detail.feedbackId || null;
          
          if (feedback) {
            // Handle both object and ID reference
            const feedbackObj = typeof feedback === 'object' ? feedback : null;
            
            if (feedbackObj) {
              // Check for actual content/rating
              const hasContent = feedbackObj.content && feedbackObj.content.trim() !== '';
              const hasRating = feedbackObj.rating !== null && feedbackObj.rating !== undefined && feedbackObj.rating >= 1 && feedbackObj.rating <= 5;
              // Also check has_* flags if they exist
              const hasContentFlag = feedbackObj.has_content === true;
              const hasRatingFlag = feedbackObj.has_rating === true;
              const isDeleted = feedbackObj.is_deleted === true;

              // Include feedback ONLY if it has content OR rating (checking both direct values and flags)
              // Filter out feedbacks with no rating and no content
              // Include deleted feedbacks so they can be shown with deletion message (but only if they have rating or content)
              if ((hasContent || hasRating || hasContentFlag || hasRatingFlag)) {
                // Note: getUserOrdersService returns variant_id (not variant) with populated productId
                // But getOrder returns variant, so we need to handle both
                const variantId = detail.variant_id?._id || detail.variant?._id || detail.variant_id || detail.variant || null;
                const variantKey = variantId || `item_${index}`;
                
                // Try multiple paths for product information
                const productName = 
                  detail.variant_id?.productId?.productName || 
                  detail.variant_id?.productId?.name ||
                  detail.variant?.productId?.productName ||
                  detail.variant?.product?.name || 
                  detail.variant?.productId?.name ||
                  "Product (Variant not available)";
                
                const productImage = 
                  detail.variant_id?.variantImage || 
                  detail.variant_id?.image ||
                  detail.variant?.variantImage || 
                  detail.variant?.image || 
                  "/placeholder.png";
                
                const color = 
                  detail.variant_id?.productColorId?.color_name || 
                  detail.variant_id?.color?.name ||
                  detail.variant?.productColorId?.color_name || 
                  detail.variant?.color?.name || 
                  "N/A";
                
                const size = 
                  detail.variant_id?.productSizeId?.size_name || 
                  detail.variant_id?.size?.name ||
                  detail.variant?.productSizeId?.size_name || 
                  detail.variant?.size?.name || 
                  "N/A";
                
                feedbackList.push({
                  _id: `${order._id}_${variantKey}`,
                  orderId: order._id,
                  orderDate: order.orderDate || order.createdAt,
                  orderStatus: order.order_status,
                  variant: detail.variant_id || detail.variant,
                  variantId: variantId,
                  feedback: feedbackObj,
                  orderDetail: detail,
                  productName,
                  productImage,
                  color,
                  size,
                  quantity: detail.quantity,
                  unitPrice: detail.unitPrice || detail.UnitPrice,
                  totalPrice: detail.totalPrice || detail.TotalPrice,
                });
              }
            }
          }
        });
      }
    });

    // Sort by order date (newest first)
    return feedbackList.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));
  }, []);

  // Extract eligible items (delivered orders without feedback)
  const extractEligibleItems = useCallback((orders) => {
    const eligibleList = [];

    orders.forEach((order) => {
      // Only process delivered orders
      if (order.order_status?.toLowerCase() !== 'delivered') {
        return;
      }

      if (order.orderDetails && Array.isArray(order.orderDetails)) {
        order.orderDetails.forEach((detail, index) => {
          // Check if feedback exists
          const feedback = detail.feedback || detail.feedbackId || null;
          const feedbackObj = typeof feedback === 'object' ? feedback : null;
          
          // Check if feedback exists and is valid (must have rating or content)
          let hasValidFeedback = false;
          if (feedbackObj) {
            const hasContent = feedbackObj.content && feedbackObj.content.trim() !== '';
            const hasRating = feedbackObj.rating !== null && feedbackObj.rating !== undefined && feedbackObj.rating >= 1 && feedbackObj.rating <= 5;
            const hasContentFlag = feedbackObj.has_content === true;
            const hasRatingFlag = feedbackObj.has_rating === true;
            
            // Only consider valid if it has rating OR content
            hasValidFeedback = (hasContent || hasRating || hasContentFlag || hasRatingFlag);
          }

          // If no valid feedback exists, this item is eligible
          if (!hasValidFeedback) {
            const variantId = detail.variant_id?._id || detail.variant?._id || detail.variant_id || detail.variant || null;
            const variantKey = variantId || `item_${index}`;
            
            // Try multiple paths for product information
            const productName = 
              detail.variant_id?.productId?.productName || 
              detail.variant_id?.productId?.name ||
              detail.variant?.productId?.productName ||
              detail.variant?.product?.name || 
              detail.variant?.productId?.name ||
              "Product (Variant not available)";
            
            const productImage = 
              detail.variant_id?.variantImage || 
              detail.variant_id?.image ||
              detail.variant?.variantImage || 
              detail.variant?.image || 
              "/placeholder.png";
            
            const color = 
              detail.variant_id?.productColorId?.color_name || 
              detail.variant_id?.color?.name ||
              detail.variant?.productColorId?.color_name || 
              detail.variant?.color?.name || 
              "N/A";
            
            const size = 
              detail.variant_id?.productSizeId?.size_name || 
              detail.variant_id?.size?.name ||
              detail.variant?.productSizeId?.size_name || 
              detail.variant?.size?.name || 
              "N/A";
            
            eligibleList.push({
              _id: `${order._id}_${variantKey}`,
              orderId: order._id,
              orderDate: order.orderDate || order.createdAt,
              orderStatus: order.order_status,
              variant: detail.variant_id || detail.variant,
              variantId: variantId,
              orderDetail: detail,
              productName,
              productImage,
              color,
              size,
              quantity: detail.quantity,
              unitPrice: detail.unitPrice || detail.UnitPrice,
              totalPrice: detail.totalPrice || detail.TotalPrice,
            });
          }
        });
      }
    });

    // Sort by order date (newest first)
    return eligibleList.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));
  }, []);

  const fetchFeedbacks = useCallback(
    async () => {
      if (!user?._id) {
        showToast("No user ID available", "error");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const token = localStorage.getItem("token");
        const response = await Api.order.getOrders(user._id, token);
        const data = response.data.data || [];

        if (!Array.isArray(data)) {
          showToast("Invalid API response format", "error");
          setFeedbacks([]);
          setFilteredFeedbacks([]);
          setLoading(false);
          return;
        }

        // Debug: Check if any order has feedbacks
        let totalFeedbacksFound = 0;
        data.forEach((order, orderIndex) => {
          if (order.orderDetails && Array.isArray(order.orderDetails)) {
            order.orderDetails.forEach((detail, detailIndex) => {
              if (detail.feedback) {
                totalFeedbacksFound++;
              }
            });
          }
        });

        // Extract feedbacks from all orders
        const feedbackList = extractFeedbacksFromOrders(data);
        
        // Extract eligible items (delivered orders without feedback)
        const eligibleList = extractEligibleItems(data);
        
        setFeedbacks(feedbackList);
        setFilteredFeedbacks(feedbackList);
        setEligibleItems(eligibleList);
        setFilteredEligibleItems(eligibleList);
      } catch (err) {
        console.error("Error fetching feedbacks:", err);
        setError(err.message || "Failed to load feedbacks");
        showToast("Failed to load feedbacks", "error");
        setFeedbacks([]);
        setFilteredFeedbacks([]);
      } finally {
        setLoading(false);
      }
    },
    [user, showToast, extractFeedbacksFromOrders, extractEligibleItems]
  );

  useEffect(() => {
    if (!isAuthLoading && user) {
      fetchFeedbacks();
    }
  }, [isAuthLoading, user, fetchFeedbacks]);

  const handleSearchAndFilter = useCallback(() => {
    let filtered = [...feedbacks];
    let filteredEligible = [...eligibleItems];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((feedback) => {
        // Search by Product Name
        if (feedback.productName?.toLowerCase().includes(query)) {
          return true;
        }

        // Search by Feedback Content
        if (feedback.feedback?.content?.toLowerCase().includes(query)) {
          return true;
        }

        // Search by Order ID
        if (feedback.orderId?.toLowerCase().includes(query)) {
          return true;
        }

        return false;
      });

      filteredEligible = filteredEligible.filter((item) => {
        // Search by Product Name
        if (item.productName?.toLowerCase().includes(query)) {
          return true;
        }

        // Search by Order ID
        if (item.orderId?.toLowerCase().includes(query)) {
          return true;
        }

        return false;
      });
    }

    setFilteredFeedbacks(filtered);
    setFilteredEligibleItems(filteredEligible);
  }, [feedbacks, eligibleItems, searchQuery]);

  useEffect(() => {
    handleSearchAndFilter();
    setCurrentPage(1);
  }, [handleSearchAndFilter]);

  const displayItems = showEligibleOnly ? filteredEligibleItems : filteredFeedbacks;
  const totalPages = Math.ceil(displayItems.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentItems = displayItems.slice(startIndex, endIndex);

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  // Render star rating
  const renderStars = (rating) => {
    if (!rating || rating < 1) return null;
    return (
      <div className="flex items-center gap-1">
        {[...Array(5)].map((_, i) => (
          <svg
            key={i}
            className={`w-4 h-4 ${i < rating ? 'text-yellow-400 fill-current' : 'text-gray-300'}`}
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        ))}
      </div>
    );
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
          <h1 className="text-xl sm:text-2xl font-normal mb-2 m-0">My Feedback</h1>
          <p className="text-sm text-gray-600 mb-4">
            View and manage your product feedbacks. Click on a feedback to see detailed information or edit it.
            {eligibleItems.length > 0 && (
              <span className="block mt-2 text-blue-600">
                You have {eligibleItems.length} delivered order{eligibleItems.length !== 1 ? 's' : ''} waiting for feedback.
              </span>
            )}
          </p>
          {eligibleItems.length > 0 && (
            <div className="flex gap-2 mb-4">
              <ProductButton
                variant={!showEligibleOnly ? "primary" : "default"}
                size="sm"
                onClick={() => setShowEligibleOnly(false)}
              >
                My Feedbacks ({feedbacks.length})
              </ProductButton>
              <ProductButton
                variant={showEligibleOnly ? "primary" : "default"}
                size="sm"
                onClick={() => setShowEligibleOnly(true)}
              >
                Pending Feedback ({eligibleItems.length})
              </ProductButton>
            </div>
          )}
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
                      placeholder="Search by product name, feedback content, or order ID..."
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
            {showEligibleOnly ? (
              <>
                Showing {Math.min(startIndex + 1, filteredEligibleItems.length)}–
                {Math.min(endIndex, filteredEligibleItems.length)} of {filteredEligibleItems.length}{" "}
                eligible item{filteredEligibleItems.length !== 1 ? "s" : ""}
              </>
            ) : (
              <>
                Showing {Math.min(startIndex + 1, filteredFeedbacks.length)}–
                {Math.min(endIndex, filteredFeedbacks.length)} of {filteredFeedbacks.length}{" "}
                feedback{filteredFeedbacks.length !== 1 ? "s" : ""}
              </>
            )}
          </p>
        </div>

        {loading ? (
          <LoadingSkeleton count={3} />
        ) : displayItems.length === 0 ? (
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
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>
            </div>
            {showEligibleOnly ? (
              eligibleItems.length === 0 ? (
                <>
                  <p className="text-gray-500 italic text-lg">No eligible orders found</p>
                  <p className="text-gray-400 text-sm mt-2">
                    All your delivered orders have been reviewed
                  </p>
                </>
              ) : (
                <>
                  <p className="text-gray-500 italic text-lg">
                    No eligible items match your search
                  </p>
                  <p className="text-gray-400 text-sm mt-2">
                    Try adjusting your search criteria
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
              )
            ) : (
              feedbacks.length === 0 ? (
                <>
                  <p className="text-gray-500 italic text-lg">No feedbacks found</p>
                  <p className="text-gray-400 text-sm mt-2">
                    Your feedbacks will appear here once you review products from your orders
                  </p>
                  <ProductButton
                    variant="default"
                    size="sm"
                    onClick={() => navigate("/orders")}
                    className="text-blue-600"
                  >
                    View Orders
                  </ProductButton>
                </>
              ) : (
                <>
                  <p className="text-gray-500 italic text-lg">
                    No feedbacks match your search
                  </p>
                  <p className="text-gray-400 text-sm mt-2">
                    Try adjusting your search criteria
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
              )
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {currentItems.map((item) => {
              const { productName, productImage, orderId, orderDate, feedback } = item;

              return (
                <article
                  key={item._id}
                  className="bg-white border-2 border-gray-300 rounded-xl p-4 sm:p-5 mb-4 last:mb-0 flex flex-col sm:flex-row gap-4 transition-shadow hover:shadow-sm border border-gray-200 focus-within:shadow-sm"
                  tabIndex={0}
                  aria-label={showEligibleOnly ? `Eligible item: ${productName}` : `Feedback for ${productName}`}
                >
                  <div className="flex items-stretch gap-6 flex-1">
                    {/* Product Image */}
                    <img
                      src={productImage}
                      alt={productName}
                      className="w-20 sm:w-24 aspect-square object-cover rounded-lg flex-shrink-0"
                      onError={(e) => {
                        e.target.src = "/placeholder.png";
                      }}
                    />

                    {/* Feedback Details */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
                      {/* Product name with date inline */}
                      <p className="text-base sm:text-lg font-semibold text-gray-900 m-0 line-clamp-2">
                        {productName} <span className="text-sm font-normal text-gray-500">• {formatDate(orderDate)}</span>
                      </p>

                      {showEligibleOnly ? (
                        <p className="text-sm text-blue-600 italic m-0">
                          Waiting for your feedback
                        </p>
                      ) : (
                        <>
                          {/* Rating */}
                          {(feedback?.has_rating || feedback?.rating) && feedback?.rating && feedback.rating > 0 && (
                            <div className="flex items-center gap-2">
                              {renderStars(feedback.rating)}
                              <span className="text-sm text-gray-600">
                                {feedback.rating}/5
                              </span>
                            </div>
                          )}

                          {/* Feedback Content */}
                          {feedback?.is_deleted ? (
                            <p className="text-sm text-gray-500 italic m-0 line-clamp-3">
                              This feedback has been deleted by staff/admin
                            </p>
                          ) : feedback?.content && feedback.content.trim() !== '' ? (
                            <p className="text-sm text-gray-700 m-0 line-clamp-3">
                              {feedback.content}
                            </p>
                          ) : (
                            <p className="text-sm text-gray-400 italic m-0">
                              No comment provided
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-row sm:flex-col items-center sm:items-center sm:justify-center gap-3 sm:gap-4">
                    <ProductButton
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setSelectedFeedback(item);
                        setSelectedOrderId(orderId);
                      }}
                      title={showEligibleOnly ? "Create Feedback" : "View Details"}
                    >
                      {showEligibleOnly ? (
                        <>
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
                              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                            />
                          </svg>
                          Create Feedback
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
                    </ProductButton>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {displayItems.length > itemsPerPage && (
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

      {selectedFeedback && selectedOrderId && (
        <FeedbackDetailsModal
          feedback={selectedFeedback}
          orderId={selectedOrderId}
          onClose={() => {
            setSelectedFeedback(null);
            setSelectedOrderId(null);
          }}
          onUpdate={fetchFeedbacks}
        />
      )}
    </div>
  );
};

export default Feedback;

