import React, {
  useState,
  useEffect,
  useContext,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useNavigate } from "react-router-dom";
import { AuthContext } from "../../context/AuthContext";
import { useToast } from "../../hooks/useToast";
import Api from "../../common/SummaryAPI";
import LoadingSpinner from "../../components/LoadingSpinner";
import ProductButton from "../../components/ProductButton";
import ConfirmationModal from "../../components/ConfirmationModal";
import {
  API_RETRY_COUNT,
  API_RETRY_DELAY,
  TOAST_TIMEOUT,
} from "../../constants/constants";

// Custom hook for debounced values
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
};

// API retry function
const fetchWithRetry = async (apiCall, retries = API_RETRY_COUNT, delay = API_RETRY_DELAY) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await apiCall();
      return response.data;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
};

const Cart = () => {
  const { user } = useContext(AuthContext);
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [cartItems, setCartItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [updatingQuantities, setUpdatingQuantities] = useState(new Set());
  const [error, setError] = useState(null);
  const [quantityValues, setQuantityValues] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  // Track last saved quantities to compare against (not optimistic updates)
  const lastSavedQuantities = useRef({});

  // Cache for cart items
  const cartCache = useRef({ items: [], timestamp: 0 });

  // Debounced quantity values
  const debouncedQuantities = useDebounce(quantityValues, 500);

  // Fetch cart items
  const fetchCartItems = useCallback(
    async (showLoading = true) => {
      if (!user?._id) {
        return;
      }

      const now = Date.now();
      const cacheAge = now - cartCache.current.timestamp;

      // Use cache if data is fresh (less than 30 seconds old) and not explicitly loading
      if (
        cartCache.current.items.length > 0 &&
        cacheAge < 30000 &&
        !showLoading
      ) {
        setCartItems(cartCache.current.items);
        return;
      }

      if (showLoading) setLoading(true);
      setError(null);

      try {
        const token = localStorage.getItem("token");
        if (!token) throw new Error("No authentication token found");

        const response = await fetchWithRetry(() =>
          Api.newCart.getByAccount(user._id, token)
        );

        const data = response?.data || response;
        const items = Array.isArray(data)
          ? data
            .map((i) => {
              if (!i.variantId) {
                console.warn("Cart item missing variantId:", i);
                return null;
              }
                return { ...i, checked: i.selected || false };
            })
            .filter((item) => item !== null)
          : [];

        setCartItems(items);
        cartCache.current = { items, timestamp: now };

        // Initialize quantity values and last saved quantities
        const initialQuantities = {};
        const savedQuantities = {};
        items.forEach((item) => {
          const qty = parseInt(item.productQuantity, 10) || 1;
          initialQuantities[item._id] = qty;
          savedQuantities[item._id] = qty;
        });
        setQuantityValues(initialQuantities);
        lastSavedQuantities.current = savedQuantities;
      } catch (err) {
        console.error("Fetch cart error:", err);
        let errorMessage = "Failed to load cart items";
        
        if (err?.response?.data?.message) {
          errorMessage = err.response.data.message;
        } else if (err?.message) {
          errorMessage = err.message;
        } else if (!err.response) {
          errorMessage = "Failed to load cart items. Please try again later.";
        }
        
        setError(errorMessage);
        showToast(errorMessage, "error", TOAST_TIMEOUT);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [user, showToast]
  );

  // Initial fetch
  useEffect(() => {
    if (!user && !localStorage.getItem("token")) {
      navigate("/login", { replace: true });
    } else if (user) {
      fetchCartItems();
    }
  }, [user, navigate, fetchCartItems]);

  // Update quantity when debounced value changes
  useEffect(() => {
    const updateQuantities = async () => {
      if (!user?._id || Object.keys(debouncedQuantities).length === 0) return;

        const token = localStorage.getItem("token");
      if (!token) return;

      // Use functional update to get the latest cartItems state
      setCartItems((currentItems) => {
        const updates = [];
        const updatingIds = new Set();

        // Prepare updates by comparing debounced values with last saved quantities
        for (const [cartId, newQuantityRaw] of Object.entries(debouncedQuantities)) {
          const item = currentItems.find((i) => i._id === cartId);
          if (!item) continue;

          // Skip if empty string
          if (newQuantityRaw === "" || newQuantityRaw === null || newQuantityRaw === undefined) continue;

          const newQuantity = typeof newQuantityRaw === "number" 
            ? newQuantityRaw 
            : parseInt(newQuantityRaw, 10);
          
          if (isNaN(newQuantity) || newQuantity < 1) continue;

          // Compare against last saved quantity (not optimistic update)
          const lastSavedQty = lastSavedQuantities.current[cartId];
          const savedQuantity = lastSavedQty !== undefined ? lastSavedQty : (parseInt(item.productQuantity, 10) || 1);
          
          // Only update if different from what was last saved
          if (newQuantity === savedQuantity) continue;

          updates.push({ 
          cartId,
            newQuantity, 
            originalQuantity: savedQuantity,
            item 
          });
          updatingIds.add(cartId);
        }

        if (updates.length === 0) return currentItems;

        // Mark items as updating
        setUpdatingQuantities(updatingIds);

        // Invalidate cache to force fresh fetch on next page load
        cartCache.current = { items: [], timestamp: 0 };

        // Perform API updates
        Promise.all(
          updates.map(async ({ cartId, newQuantity }) => {
            try {
              const response = await Api.newCart.update(
                cartId,
                { productQuantity: newQuantity.toString() },
                token
              );
              return { cartId, response, newQuantity, success: true };
      } catch (err) {
              console.error("API update error for", cartId, ":", err);
              return { cartId, error: err, newQuantity, success: false };
            }
          })
        )
          .then((results) => {
            // Check if all updates succeeded
            const allSucceeded = results.every(r => r.success);
            
            if (allSucceeded) {
              // Update local state using API response data when available
              setCartItems((prevItems) => {
                const updatedItems = prevItems.map((item) => {
                  const result = results.find((r) => r.cartId === item._id);
                  if (result && result.success) {
                    // Try to get updated quantity from API response
                    let updatedQuantity = result.newQuantity;
                    
                    if (result.response?.data) {
                      const responseData = result.response.data?.data || result.response.data;
                      if (responseData?.productQuantity !== undefined) {
                        updatedQuantity = parseInt(responseData.productQuantity, 10);
                      }
                    }

                    const updatedItem = { 
                      ...item, 
                      productQuantity: updatedQuantity.toString()
                    };
                    return updatedItem;
                  }
                  return item;
                });
                
                // Update cache with fresh data
                cartCache.current = { items: updatedItems, timestamp: 0 };
                
                // Update last saved quantities
                results.forEach(({ cartId, newQuantity }) => {
                  if (newQuantity !== undefined) {
                    lastSavedQuantities.current[cartId] = newQuantity;
                  }
                });
                
                // Sync quantityValues with updated quantities
                setQuantityValues((prev) => {
                  const updated = { ...prev };
                  results.forEach(({ cartId, newQuantity }) => {
                    if (newQuantity !== undefined) {
                      updated[cartId] = newQuantity;
                    }
                  });
                  return updated;
                });
                
                return updatedItems;
              });
            } else {
              // Some updates failed - revert all
              const failedResults = results.filter(r => !r.success);
              console.error("Some updates failed:", failedResults);
              
              const errorMessage = "Failed to update quantity";
              showToast(errorMessage, "error", TOAST_TIMEOUT);

              // Revert to original quantities
              setCartItems((prevItems) => {
                const revertedItems = prevItems.map((item) => {
                  const update = updates.find((u) => u.cartId === item._id);
                  if (update) {
                    return { 
                      ...item, 
                      productQuantity: update.originalQuantity.toString() 
                    };
                  }
                  return item;
                });
                
                // Also revert quantityValues and last saved quantities
                setQuantityValues((prev) => {
                  const updated = { ...prev };
                  updates.forEach(({ cartId, originalQuantity }) => {
                    updated[cartId] = originalQuantity;
                    lastSavedQuantities.current[cartId] = originalQuantity;
                  });
                  return updated;
                });
                
                return revertedItems;
              });
            }
          })
          .finally(() => {
            setUpdatingQuantities((prev) => {
              const updated = new Set(prev);
              updatingIds.forEach((id) => updated.delete(id));
              return updated;
            });
          });

        return currentItems;
      });
    };

    updateQuantities();
  }, [debouncedQuantities, user, showToast]);

  // Show confirmation modal for removing item
  const handleRemoveItemClick = useCallback((cartId) => {
    const item = cartItems.find((item) => item._id === cartId);
    setItemToDelete({ cartId, item });
    setShowDeleteConfirm(true);
  }, [cartItems]);

  // Remove item from cart (after confirmation)
  const handleRemoveItem = useCallback(
    async () => {
      if (!user?._id || !itemToDelete) return;

      const { cartId } = itemToDelete;
      setShowDeleteConfirm(false);
      setActionInProgress(true);
      setError(null);
      const previousItems = [...cartItems];
      const itemToRemove = cartItems.find((item) => item._id === cartId);

      // Optimistic update
      setCartItems((prev) => prev.filter((item) => item._id !== cartId));
      setQuantityValues((prev) => {
        const updated = { ...prev };
        delete updated[cartId];
        return updated;
      });

      try {
        const token = localStorage.getItem("token");
        if (!token) throw new Error("No authentication token found");

        await Api.newCart.delete(cartId, token);

        cartCache.current = {
          items: cartItems.filter((item) => item._id !== cartId),
          timestamp: Date.now(),
        };
        showToast("Item removed from cart", "success", TOAST_TIMEOUT);
      } catch (err) {
        const errorMessage =
          err.response?.data?.message || err.message || "Failed to remove item";
        console.error("Remove item error:", err);
        setError(errorMessage);
        setCartItems(previousItems);
        if (itemToRemove) {
          setQuantityValues((prev) => ({
            ...prev,
            [cartId]: parseInt(itemToRemove.productQuantity, 10) || 1,
          }));
        }
        showToast(errorMessage, "error", TOAST_TIMEOUT);
      } finally {
        setActionInProgress(false);
        setItemToDelete(null);
      }
    },
    [cartItems, user, showToast, itemToDelete]
  );

  // Format price helper
  const formatPrice = useCallback((price) => {
    if (typeof price !== "number" || isNaN(price)) return "N/A";
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
    }).format(price);
  }, []);

  // Filter cart items based on search query
  const filteredCartItems = useMemo(() => {
    if (!searchQuery.trim()) {
      return cartItems;
    }

    const query = searchQuery.toLowerCase().trim();
    return cartItems.filter((item) => {
      // Search by product name
      const productName = item.variantId?.productId?.productName?.toLowerCase() || "";
      if (productName.includes(query)) return true;

      // Search by color
      const colorName = item.variantId?.productColorId?.color_name?.toLowerCase() || "";
      if (colorName.includes(query)) return true;

      // Search by size
      const sizeName = item.variantId?.productSizeId?.size_name?.toLowerCase() || "";
      if (sizeName.includes(query)) return true;

      return false;
    });
  }, [cartItems, searchQuery]);

  // Calculate total for selected items
  const totalPrice = useMemo(() => {
    return filteredCartItems
      .filter((item) => item.checked)
      .reduce((total, item) => {
        const price = item.productPrice || 0;
        const quantity = parseInt(item.productQuantity, 10) || 0;
        return total + price * quantity;
      }, 0);
  }, [filteredCartItems]);

  // Check if any selected items are inactive
  const hasInactiveSelectedItems = useMemo(() => {
    return filteredCartItems.some((item) => {
      if (!item.checked) return false;
      const stockQuantity = item.variantId?.stockQuantity ?? 0;
      const isVariantDiscontinued = item.variantId?.variantStatus === "discontinued";
      const isProductDiscontinued = item.variantId?.productId?.productStatus === "discontinued";
      const isOutOfStock = stockQuantity <= 0;
      return isVariantDiscontinued || isProductDiscontinued || isOutOfStock;
    });
  }, [filteredCartItems]);

  // Handle quantity change
  const handleQuantityChange = useCallback(
    (cartId, value) => {
      // Handle empty input - allow it temporarily for better UX
      if (value === "" || value === null || value === undefined) {
        setQuantityValues((prev) => ({ ...prev, [cartId]: "" }));
        return;
      }

      const newQuantity = parseInt(value, 10);
      const currentItem = cartItems.find((item) => item._id === cartId);

      if (!currentItem) return;

      const maxQuantity = currentItem.variantId?.stockQuantity || Infinity;

      // Validate and clamp quantity
      if (isNaN(newQuantity)) {
        // If invalid, revert to current quantity
        const currentQty = parseInt(currentItem.productQuantity, 10) || 1;
        setQuantityValues((prev) => ({ ...prev, [cartId]: currentQty }));
        return;
      }

      if (newQuantity < 1) {
        setQuantityValues((prev) => ({ ...prev, [cartId]: 1 }));
        return;
      }

      if (newQuantity > maxQuantity) {
        showToast(
          `Quantity cannot exceed available stock (${maxQuantity})`,
          "error",
          TOAST_TIMEOUT
        );
        setQuantityValues((prev) => ({ ...prev, [cartId]: maxQuantity }));
        return;
      }

      // Update local state immediately for responsive UI
      // Only update quantityValues - let the debounced effect handle cartItems update
      setQuantityValues((prev) => ({ ...prev, [cartId]: newQuantity }));
      
      // Optimistically update cartItems for immediate UI feedback
        setCartItems((prev) =>
          prev.map((item) =>
            item._id === cartId
            ? { ...item, productQuantity: newQuantity.toString() }
              : item
          )
        );
    },
    [cartItems, showToast]
  );

  // Retry handler
  const handleRetry = useCallback(() => {
    cartCache.current = { items: [], timestamp: 0 };
    fetchCartItems(true);
  }, [fetchCartItems]);

  // Toggle checked state
  const toggleChecked = useCallback((cartId) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item._id === cartId ? { ...item, checked: !item.checked } : item
      )
    );
  }, []);

  // Focus error notification
  const errorRef = useRef(null);
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.focus();
    }
  }, [error]);

  // Cart Item Skeleton Component
  const CartItemSkeleton = () => (
    <article
      className="bg-white border-2 border-gray-300 rounded-xl p-4 sm:p-5 mb-4 last:mb-0 flex flex-col sm:flex-row gap-4 transition-shadow hover:shadow-sm border border-gray-200 focus-within:shadow-sm"
      aria-label="Loading cart item"
    >
      <div className="flex items-stretch gap-6 flex-1">
        {/* Checkbox skeleton */}
        <div className="w-5 h-5 bg-gray-200 rounded animate-pulse flex-shrink-0 self-center" />
        {/* Image skeleton */}
        <div className="w-20 sm:w-24 aspect-square bg-gray-200 rounded-lg animate-pulse flex-shrink-0" />
        {/* Product info skeleton */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
          {/* Product name */}
          <div className="h-5 sm:h-6 bg-gray-200 rounded animate-pulse w-3/4" />
          {/* Color and Size */}
          <div className="h-4 bg-gray-200 rounded animate-pulse w-2/3" />
          {/* Price */}
          <div className="h-4 bg-gray-200 rounded animate-pulse w-1/3" />
          {/* Total */}
          <div className="h-5 bg-gray-200 rounded animate-pulse w-1/4" />
        </div>
      </div>
      {/* Action buttons skeleton */}
      <div className="flex flex-row sm:flex-col items-center sm:items-center sm:justify-center gap-3 sm:gap-4">
        {/* Quantity input skeleton */}
        <div className="w-20 h-10 bg-gray-200 rounded-md animate-pulse" />
        {/* Remove button skeleton */}
        <div className="w-20 h-10 bg-gray-200 rounded-md animate-pulse" />
      </div>
    </article>
  );

  return (
    <div className="flex flex-col items-center w-full max-w-7xl mx-auto my-3 sm:my-4 md:my-5 p-3 sm:p-4 md:p-5 lg:p-6 text-gray-900">
      <section className="bg-white rounded-xl p-4 sm:p-5 md:p-6 w-full max-w-5xl shadow-sm border border-gray-200">
        <h2 className="text-xl sm:text-2xl font-normal mb-4 sm:mb-5 md:mb-6 m-0">
          Shopping Cart
        </h2>

        {/* Search Bar */}
        {!loading && cartItems.length > 0 && (
          <div className="mb-4 sm:mb-5 md:mb-6">
            <fieldset className="border-2 border-gray-300 rounded-xl p-3 sm:p-4">
              <legend className="text-sm sm:text-base font-semibold m-0">Search</legend>
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search by product name, color, or size..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full p-3 pl-10 border-2 border-gray-300 rounded-md bg-white text-sm transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                      aria-label="Search cart items"
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
                </div>
                {searchQuery && (
                  <div className="flex items-end">
                    <ProductButton
                      variant="default"
                      size="md"
                      onClick={() => setSearchQuery("")}
                      aria-label="Clear search"
                    >
                      Clear
                    </ProductButton>
                  </div>
                )}
              </div>
            </fieldset>
          </div>
        )}

      {error && (
        <div
            ref={errorRef}
            className="text-center text-xs sm:text-sm text-red-600 bg-red-50 border-2 border-red-200 rounded-xl p-4 sm:p-6 md:p-8 mb-3 sm:mb-4 w-full flex items-center justify-center gap-2 sm:gap-2.5 flex-wrap"
          role="alert"
          tabIndex={0}
          aria-live="polite"
        >
            <span className="text-lg" aria-hidden="true">
            ⚠
          </span>
          {error}
          <ProductButton
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            disabled={loading}
            aria-label="Retry loading cart items"
          >
            Retry
          </ProductButton>
        </div>
      )}

      {!loading && cartItems.length === 0 && !error && !searchQuery ? (
          <div
            className="text-center text-xs sm:text-sm text-gray-500 p-4 sm:p-6 md:p-8 w-full min-h-[200px] flex flex-col items-center justify-center gap-4"
            role="status"
          >
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900 m-0">
              Your cart is empty.
            </h3>
          <ProductButton
            variant="primary"
            size="md"
            onClick={() => navigate("/products")}
            aria-label="Continue shopping"
          >
            Continue Shopping
          </ProductButton>
        </div>
      ) : (
          <main className="flex flex-col sm:flex-row gap-4 sm:gap-6 md:gap-8" role="main">
            <section className="flex-1 min-w-0" aria-label="Cart items">
              {loading ? (
                <>
                  {[...Array(3)].map((_, index) => (
                    <CartItemSkeleton key={`skeleton-${index}`} />
                  ))}
                </>
              ) : filteredCartItems.length === 0 && searchQuery ? (
                <div className="text-center text-xs sm:text-sm text-gray-500 border-2 border-gray-300 rounded-xl p-4 sm:p-6 md:p-8 mb-3 sm:mb-4 w-full min-h-[200px] flex flex-col items-center justify-center gap-4" role="status">
                  <p className="text-gray-500 italic text-lg">No items match your search</p>
                  <p className="text-gray-400 text-sm mt-2">
                    Try adjusting your search criteria
                  </p>
                  <ProductButton
                    variant="default"
                    size="sm"
                    onClick={() => setSearchQuery("")}
                    className="text-blue-600"
                  >
                    Clear Search
                  </ProductButton>
                </div>
              ) : (
                filteredCartItems.map((item) => {
                const quantityValue = quantityValues[item._id];
                const quantity = quantityValue !== undefined && quantityValue !== ""
                  ? (typeof quantityValue === "number" ? quantityValue : parseInt(quantityValue, 10))
                  : parseInt(item.productQuantity, 10) || 1;
                const maxQuantity = item.variantId?.stockQuantity || Infinity;
                const isUpdating = updatingQuantities.has(item._id);
                const stockQuantity = item.variantId?.stockQuantity ?? 0;
                const isVariantDiscontinued = item.variantId?.variantStatus === "discontinued";
                const isProductDiscontinued = item.variantId?.productId?.productStatus === "discontinued";
                const isOutOfStock = stockQuantity <= 0;
                const isInactive = isVariantDiscontinued || isProductDiscontinued || isOutOfStock;
                const inactiveMessage = isProductDiscontinued || isVariantDiscontinued 
                  ? "Discontinued" 
                  : isOutOfStock 
                    ? "Out of Stock" 
                    : "";

              return (
                <article
                  key={item._id}
                    className={`bg-white border-2 border-gray-300 rounded-xl p-4 sm:p-5 mb-4 last:mb-0 flex flex-col sm:flex-row gap-4 transition-shadow hover:shadow-sm border border-gray-200 focus-within:shadow-sm border border-gray-200 ${isInactive ? "opacity-60 grayscale" : ""}`}
                  tabIndex={0}
                    aria-label={`Cart item: ${item.variantId?.productId?.productName || "Unnamed Product"}`}
                >
                    <div className="flex items-stretch gap-6 flex-1">
                  <input
                    type="checkbox"
                    checked={item.checked || false}
                    onChange={() => toggleChecked(item._id)}
                        className="w-5 h-5 accent-amber-400 cursor-pointer flex-shrink-0 self-center disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label={`Select ${item.variantId?.productId?.productName || "product"} for checkout`}
                        disabled={isInactive}
                  />
                  <img
                        src={item.variantId?.variantImage || "/placeholder-image.png"}
                    alt={item.variantId?.productId?.productName || "Product"}
                        className="w-20 sm:w-24 aspect-square object-cover rounded-lg flex-shrink-0"
                        onError={(e) => {
                          e.target.src = "/placeholder-image.png";
                        }}
                      />
                      <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
                        <p className="text-base sm:text-lg font-semibold text-gray-900 m-0 line-clamp-2">
                      {item.variantId?.productId?.productName || "Unnamed Product"}
                    </p>
                        <p className="text-sm text-gray-600 m-0">
                          Color: {item.variantId?.productColorId?.color_name || "N/A"}, Size:{" "}
                          {item.variantId?.productSizeId?.size_name || "N/A"}
                        </p>
                        <p className="text-sm text-gray-600 m-0">
                      Price: {formatPrice(item.productPrice)}
                    </p>
                        <p className="text-sm text-gray-600 m-0">
                          Stock: {stockQuantity}
                    </p>
                        {isInactive && (
                          <p className="text-sm font-semibold text-red-600 m-0">
                            {inactiveMessage}
                          </p>
                        )}
                        <p className="text-base font-semibold text-red-600 m-0">
                          Total: {formatPrice((item.productPrice || 0) * quantity)}
                    </p>
                  </div>
                    </div>

                    <div className="flex flex-row sm:flex-col items-center sm:items-center sm:justify-center gap-3 sm:gap-4">
                      <div className="flex flex-col gap-2">
                        <input
                          type="number"
                          id={`quantity-${item._id}`}
                          min="1"
                          max={maxQuantity}
                          value={quantityValue !== undefined ? quantityValue : quantity}
                          onChange={(e) => handleQuantityChange(item._id, e.target.value)}
                          onBlur={(e) => {
                            // Ensure valid value on blur
                            const value = e.target.value;
                            if (value === "" || isNaN(parseInt(value, 10))) {
                              const currentQty = parseInt(item.productQuantity, 10) || 1;
                              setQuantityValues((prev) => ({ ...prev, [item._id]: currentQty }));
                            }
                          }}
                          className="px-3 py-1.5 border-2 border-gray-300 rounded-md bg-white text-sm w-20 transition-colors hover:bg-gray-50 hover:border-blue-600 focus:outline-none disabled:bg-gray-200 disabled:border-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                          aria-label={`Quantity for ${item.variantId?.productId?.productName || "product"}`}
                          disabled={isUpdating || actionInProgress || isInactive}
                        />
                      </div>
                      <ProductButton
                        variant="danger"
                        size="sm"
                        onClick={() => handleRemoveItemClick(item._id)}
                        aria-label={`Remove ${item.variantId?.productId?.productName || "product"} from cart`}
                        disabled={isUpdating || actionInProgress}
                      >
                        Remove
                      </ProductButton>
                  </div>
                </article>
              );
              })
              )}
          </section>

            {!loading && filteredCartItems.length > 0 && (
              <aside
                className="bg-gray-50 border-2 border-gray-300 rounded-xl p-4 sm:p-5 flex-shrink-0 sm:w-64 w-full"
                aria-label="Cart summary"
              >
                <p className="text-lg sm:text-xl font-bold text-red-600 mb-4 m-0">
                  Total: {formatPrice(totalPrice)}
                </p>
              <ProductButton
                variant="primary"
                size="lg"
                onClick={() => {
                  const selectedItems = filteredCartItems.filter((i) => i.checked);
                  navigate("/checkout", { state: { selectedItems } });
                }}
                disabled={
                  filteredCartItems.filter((i) => i.checked).length === 0 ||
                  loading ||
                  actionInProgress ||
                  hasInactiveSelectedItems
                }
                aria-label="Proceed to checkout"
                className="w-full"
              >
                Proceed to Checkout
              </ProductButton>
            </aside>
          )}
        </main>
      )}
      </section>

      {/* Confirmation Modal for Removing Item */}
      <ConfirmationModal
        isOpen={showDeleteConfirm}
        title="Remove Item from Cart"
        message={
          itemToDelete?.item
            ? `Are you sure you want to remove "${itemToDelete.item.variantId?.productId?.productName || "this product"}" from your cart?`
            : "Are you sure you want to remove this item from your cart?"
        }
        confirmText="Remove"
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleRemoveItem}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setItemToDelete(null);
        }}
      />
    </div>
  );
};

export default Cart;

