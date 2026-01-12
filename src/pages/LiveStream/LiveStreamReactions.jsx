import React, { useState, useEffect, useRef, useCallback, useContext, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Favorite } from '@mui/icons-material';
import { AuthContext } from '../../context/AuthContext';
import io from 'socket.io-client';
import { SOCKET_URL } from '../../common/axiosClient';
import Api from '../../common/SummaryAPI';

const LiveStreamReactions = ({ liveId, horizontal = false, showComments = true }) => {
    const { user } = useContext(AuthContext);
    // Keep reactionCounts for WebSocket updates (even though we don't display counts)
    // eslint-disable-next-line no-unused-vars
    const [reactionCounts, setReactionCounts] = useState({
        like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0, total: 0
    });
    const [floatingReactions, setFloatingReactions] = useState([]);
    const [showFloatingReactions, setShowFloatingReactions] = useState(false);

    const longPressTimerRef = useRef(null);
    const intervalRef = useRef(null);
    const activeButtonRef = useRef(null);
    const socketRef = useRef(null);
    const processedReactionsRef = useRef(new Set());
    // Track recent local reactions to avoid duplicate display when WebSocket broadcasts them back
    // Map structure: Map<reactionType, Set<timestamps>>
    const recentLocalReactionsRef = useRef(new Map());
    // Track server reaction IDs that we've sent and are waiting for WebSocket confirmation
    // Map<serverReactionId, {reactionType, timestamp}>
    const pendingServerReactionsRef = useRef(new Map());
    // Track displayed reactions by user+type+timeWindow to avoid duplicates
    // Key format: `${userId}_${reactionType}_${timeWindow}` where timeWindow = Math.floor(timestamp/1000)
    const displayedReactionsRef = useRef(new Map()); // Map<key, true>

    const REACTION_TYPES = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];
    const REACTION_EMOJIS = {
        like: '👍',
        love: '❤️',
        haha: '😂',
        wow: '😮',
        sad: '😢',
        angry: '😡'
    };

    const fetchReactions = useCallback(async () => {
        if (!liveId || !user) return;
        try {
            const token = localStorage.getItem('token');
            if (!token) return;
            const response = await Api.livestream.getReactions(liveId, token);
            if (response.data?.success) {
                const reactionData = response.data.data?.reactions || {
                    like: 0, love: 0, haha: 0, wow: 0, sad: 0, angry: 0, total: 0
                };
                setReactionCounts(reactionData);
            }
        } catch (error) {
            console.error('Error fetching reactions:', error);
        }
    }, [liveId, user]);

    const handleReactionClick = useCallback((emoji, reactionType, reactionData = null) => {
        if (!reactionType || typeof reactionType !== 'string') return;

        const reactionId = reactionData?._id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${reactionType}`;
        const timestamp = reactionData?.timestamp || Date.now();

        // Track processed reactions to avoid duplicates
        // For local reactions, track by unique ID
        if (reactionData?.isLocal && reactionData?.userId === user?._id) {
            processedReactionsRef.current.add(reactionId);
            setTimeout(() => processedReactionsRef.current.delete(reactionId), 3000);
        }

        // For remote reactions (from WebSocket), track by _id to avoid showing same reaction twice
        if (reactionData?._id && !reactionData?.isLocal) {
            // Only skip if already processed (avoid duplicate display)
            if (processedReactionsRef.current.has(reactionData._id)) {
                return;
            }
            processedReactionsRef.current.add(reactionData._id);
            // Clear after animation completes
            setTimeout(() => processedReactionsRef.current.delete(reactionData._id), 3000);
        }

        const validTypes = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];
        const finalType = validTypes.includes(reactionType) ? reactionType : 'like';

        const reactionEmojis = {
            like: '👍',
            love: '❤️',
            haha: '😂',
            wow: '😮',
            sad: '😢',
            angry: '😡'
        };

        // Generate random horizontal position for this reaction (-40% to +40% from center)
        const randomX = (Math.random() - 0.5) * 80; // -40% to +40%
        const randomRotation = (Math.random() - 0.5) * 30; // -15deg to +15deg

        const newReaction = {
            id: reactionId,
            type: finalType,
            timestamp,
            emoji: emoji || reactionEmojis[finalType] || '👍',
            // Store position for this specific reaction
            positionX: randomX,
            rotation: randomRotation
        };

        // Additional check: If this is NOT a local reaction from current user, check if we already have it
        // This prevents adding duplicate reactions from WebSocket when user clicks
        if (!reactionData?.isLocal || reactionData?.userId !== user?._id) {
            // This is a WebSocket reaction or from another user
            // Check if we already have a recent local reaction of this type that would cause duplicate
            const pendingKey = `${reactionData?.userId || user?._id}_${finalType}`;
            const pendingTimestamp = displayedReactionsRef.current.get(pendingKey);
            if (pendingTimestamp) {
                const now = Date.now();
                const timeDiff = now - pendingTimestamp;
                // If we just sent a local reaction of this type within 2 seconds, skip this one (it's likely our own broadcast)
                if (timeDiff >= 0 && timeDiff <= 2000 && reactionData?.userId === user?._id) {
                    return;
                }
            }
        }

        setShowFloatingReactions(true);

        setFloatingReactions(prev => {
            const exists = prev.some(r => r.id === reactionId);
            if (exists) {
                return prev;
            }
            const updated = [...prev, newReaction];
            return updated;
        });

        setTimeout(() => {
            setFloatingReactions(prev => {
                const filtered = prev.filter(r => r.id !== reactionId);
                if (filtered.length === 0) {
                    setShowFloatingReactions(false);
                }
                return filtered;
            });
            if (processedReactionsRef.current.size > 100) {
                const arr = Array.from(processedReactionsRef.current);
                processedReactionsRef.current = new Set(arr.slice(-50));
            }
        }, 2700); // Match animation duration (2500ms) + buffer
    }, [user]);

    const handleReaction = useCallback(async (reactionType, showFloat = true, skipApi = false) => {
        if (!user || !liveId) return;

        const now = Date.now();

        // Show floating animation immediately for local reaction
        if (showFloat) {
            const reactionId = `${Date.now()}_${Math.random()}_${reactionType}`;

            // Track this local reaction to prevent duplicate when WebSocket broadcasts it back
            // Simple approach: track that we just sent this reaction type
            if (!recentLocalReactionsRef.current.has(reactionType)) {
                recentLocalReactionsRef.current.set(reactionType, new Set());
            }
            recentLocalReactionsRef.current.get(reactionType).add(now);

            // Mark that we have a pending local reaction for this type
            // This will prevent any WebSocket reaction of same type from current user for next 6 seconds
            const pendingKey = `${user._id}_${reactionType}`;
            displayedReactionsRef.current.set(pendingKey, now);

            // Clear tracking after 6 seconds (server should broadcast within this time)
            setTimeout(() => {
                const timestamps = recentLocalReactionsRef.current.get(reactionType);
                if (timestamps) {
                    timestamps.delete(now);
                    if (timestamps.size === 0) {
                        recentLocalReactionsRef.current.delete(reactionType);
                    }
                }
                displayedReactionsRef.current.delete(pendingKey);
            }, 6000);

            handleReactionClick(null, reactionType, {
                _id: reactionId,
                reactionType: reactionType,
                userId: user._id,
                isLocal: true,
                timestamp: now
            });
        }

        // Skip API call if flag is set (for rapid fire mode)
        if (skipApi) return;

        // Send to backend - will trigger WebSocket broadcast to all viewers
        try {
            const token = localStorage.getItem('token');
            if (!token) return;

            const response = await Api.livestream.addReaction(
                { liveId, reactionType },
                token
            );

            if (response.data?.success) {
                // Track server reaction ID to avoid duplicate when WebSocket broadcasts it back
                const serverReactionId = response.data.data?.reaction?._id || response.data.data?._id;
                if (serverReactionId) {
                    pendingServerReactionsRef.current.set(serverReactionId, {
                        reactionType,
                        timestamp: Date.now()
                    });
                    // Clear after 5 seconds (server should broadcast within this time)
                    setTimeout(() => {
                        pendingServerReactionsRef.current.delete(serverReactionId);
                    }, 5000);
                }
                // WebSocket will handle the real-time update, no need to fetch
            }
        } catch (error) {
            console.error('Error adding reaction:', error);
        }
    }, [liveId, user, handleReactionClick]);

    const handleMouseDown = useCallback((reactionType, e) => {
        e.preventDefault();
        e.stopPropagation();

        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        activeButtonRef.current = reactionType;
        // Send first reaction immediately
        handleReaction(reactionType, true, false);

        // Setup long press for rapid fire
        longPressTimerRef.current = setTimeout(() => {
            if (activeButtonRef.current === reactionType) {
                intervalRef.current = setInterval(() => {
                    if (activeButtonRef.current === reactionType) {
                        // Rapid fire mode - show float but skip API (avoid spam)
                        handleReaction(reactionType, true, true);
                    } else {
                        if (intervalRef.current) {
                            clearInterval(intervalRef.current);
                            intervalRef.current = null;
                        }
                    }
                }, 150);
            }
        }, 300);
    }, [handleReaction]);

    const handleMouseUp = useCallback(() => {
        activeButtonRef.current = null;

        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }

        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        // First click already sent in handleMouseDown when button was pressed
        // Reaction will be broadcast via WebSocket so others can see it
    }, []);

    // Setup WebSocket for real-time reactions
    useEffect(() => {
        if (!liveId || !user) return;

        // Connect to socket
        const socket = io(SOCKET_URL, { transports: ['websocket'] });
        socketRef.current = socket;

        socket.on('connect', () => {
            socket.emit('joinLiveProductRoom', liveId);
        });

        // Listen for new reactions (real-time) - ALL users see these
        socket.on('reaction:added', (data) => {
            if (data?.reaction && data?.liveId === liveId) {
                const reactionType = data.reaction.reactionType;
                if (reactionType && ['like', 'love', 'haha', 'wow', 'sad', 'angry'].includes(reactionType)) {
                    // Update reaction counts for all users
                    setReactionCounts(prev => {
                        const updated = {
                            ...prev,
                            [reactionType]: (prev[reactionType] || 0) + 1,
                            total: (prev.total || 0) + 1
                        };
                        return updated;
                    });

                    // Show floating animation for ALL reactions received via WebSocket
                    // This ensures everyone sees reactions in real-time

                    // Extract userId from reaction - handle multiple formats
                    let reactionUserId = null;
                    if (data.reaction.userId) {
                        // Check if userId is an object with _id
                        if (typeof data.reaction.userId === 'object' && data.reaction.userId._id) {
                            reactionUserId = data.reaction.userId._id;
                        } else {
                            // Otherwise use it directly
                            reactionUserId = data.reaction.userId;
                        }
                    }

                    const currentUserId = user?._id;

                    // CRITICAL FIX: Backend doesn't send userId in WebSocket reaction
                    // So we use tracking-based approach instead
                    const now = Date.now();
                    const pendingKey = `${currentUserId}_${reactionType}`;
                    const pendingTimestamp = displayedReactionsRef.current.get(pendingKey);

                    // Check 1: If we have a pending reaction of this type from current user (within 4 seconds)
                    let shouldSkip = false;
                    if (pendingTimestamp) {
                        const timeDiff = now - pendingTimestamp;
                        if (timeDiff >= 0 && timeDiff <= 4000) {
                            shouldSkip = true;
                        }
                    }

                    // Check 2: If we have recent local reactions of this type
                    if (!shouldSkip && recentLocalReactionsRef.current.has(reactionType)) {
                        const timestamps = recentLocalReactionsRef.current.get(reactionType);
                        if (timestamps && timestamps.size > 0) {
                            // Check if any timestamp is within 4 seconds
                            const hasRecentReaction = Array.from(timestamps).some(ts => {
                                const timeDiff = now - ts;
                                return timeDiff >= 0 && timeDiff <= 4000;
                            });

                            if (hasRecentReaction) {
                                shouldSkip = true;
                            }
                        }
                    }

                    // If we should skip, clean up and return
                    if (shouldSkip) {
                        // Clean up tracking
                        if (pendingTimestamp) {
                            displayedReactionsRef.current.delete(pendingKey);
                        }

                        if (recentLocalReactionsRef.current.has(reactionType)) {
                            const timestamps = recentLocalReactionsRef.current.get(reactionType);
                            if (timestamps && timestamps.size > 0) {
                                timestamps.delete(Array.from(timestamps)[0]);
                                if (timestamps.size === 0) {
                                    recentLocalReactionsRef.current.delete(reactionType);
                                }
                            }
                        }

                        // CRITICAL: Return immediately - DO NOT call handleReactionClick
                        return;
                    }

                    // Fallback: Try userId comparison if available
                    const reactionUserIdStr = String(reactionUserId || '');
                    const currentUserIdStr = String(currentUserId || '');
                    const isFromCurrentUser = reactionUserIdStr === currentUserIdStr && reactionUserIdStr !== '';

                    if (isFromCurrentUser) {
                        return;
                    }

                    // Only show floating animation for reactions from OTHER users (real-time view)
                    handleReactionClick(null, reactionType, {
                        ...data.reaction,
                        isLocal: false, // Mark as not local since it came from WebSocket
                        broadcasted: true // Mark as broadcasted
                    });
                }
            }
        });

        // Handle connection errors
        socket.on('connect_error', (error) => {
            console.error('Reactions WebSocket connection error:', error);
        });

        socket.on('disconnect', (reason) => {
            console.warn('Reactions WebSocket disconnected:', reason);
        });

        return () => {
            socket.disconnect();
            if (socketRef.current === socket) {
                socketRef.current = null;
            }
        };
    }, [liveId, user, handleReactionClick]);

    // Initial load and periodic sync (WebSocket handles real-time updates)
    useEffect(() => {
        if (liveId && user) {
            // Initial load
            fetchReactions();

            // Periodic sync every 30 seconds (WebSocket handles real-time, this is just for consistency)
            const interval = setInterval(() => {
                fetchReactions();
            }, 30000);

            return () => clearInterval(interval);
        }
    }, [liveId, user, fetchReactions]);

    useEffect(() => {
        return () => {
            if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
            }
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, []);

    // Show all reactions (each with its own random position)
    // No grouping - each click creates a reaction at a unique position
    const allFloatingReactions = useMemo(() => {
        if (!floatingReactions || floatingReactions.length === 0) {
            return [];
        }
        // Return all reactions, each will have its own position
        return floatingReactions;
    }, [floatingReactions]);

    // Render floating reactions using Portal to ensure they're on top of video
    const floatingReactionsPortal = showFloatingReactions && allFloatingReactions.length > 0 && createPortal(
        <div
            className="fixed pointer-events-none flex items-center justify-center"
            style={{
                zIndex: 100,
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                isolation: 'isolate',
                pointerEvents: 'none'
            }}
        >
            {/* Match video player position and dimensions - 9:16 aspect ratio */}
            <div
                className="absolute"
                style={{
                    width: showComments
                        ? 'min(calc(100vw - 400px), calc((100vh - 2rem) * 9 / 16))'
                        : 'min(90vw, calc((100vh - 2rem) * 9 / 16))',
                    aspectRatio: '9/16',
                    maxWidth: '90vw',
                    maxHeight: 'calc(100vh - 2rem)',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none'
                }}
            >
                {allFloatingReactions.map((reaction, index) => {
                    // Use stored position for this reaction (set when reaction was created)
                    const positionX = reaction.positionX || 0;
                    const rotation = reaction.rotation || 0;
                    const baseDelay = index * 50; // Smaller delay for smoother appearance

                    return (
                        <div
                            key={reaction.id}
                            className="absolute animate-float-up-center"
                            style={{
                                left: `calc(50% + ${positionX}%)`,
                                bottom: '20%', // Start from bottom area of video
                                transform: 'translateX(-50%)',
                                animationDelay: `${baseDelay}ms`,
                                animationDuration: '2500ms',
                                animationFillMode: 'forwards',
                                willChange: 'transform, opacity',
                                '--rotation': `${rotation}deg`,
                                zIndex: 101,
                                position: 'absolute',
                                pointerEvents: 'none'
                            }}
                        >
                            <span
                                className="text-6xl block"
                                style={{
                                    filter: 'drop-shadow(0 4px 16px rgba(0,0,0,1))',
                                    textShadow: '0 4px 12px rgba(0,0,0,1), 0 0 30px rgba(255,255,255,0.5)',
                                    pointerEvents: 'none',
                                    display: 'block',
                                    userSelect: 'none'
                                }}
                            >
                                {reaction.emoji}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>,
        document.body
    );

    return (
        <>
            {/* Floating Reactions Portal - Rendered outside component tree to ensure correct z-index */}
            {floatingReactionsPortal}

            {/* Reactions Buttons Panel */}
            <div className={`bg-transparent flex ${horizontal ? 'flex-row items-center justify-center gap-2' : 'flex-col items-center gap-3'}`}>
                {REACTION_TYPES.map((type) => {
                    const emoji = REACTION_EMOJIS[type];

                    return (
                        <button
                            key={type}
                            className={`relative bg-black/60 backdrop-blur-md rounded-full hover:bg-black/80 transition-all duration-300 group flex flex-col items-center justify-center border border-white/10 shadow-lg hover:shadow-red-500/30 hover:scale-110 transform hover:border-red-500/50 ${horizontal ? 'p-1.5 w-12 h-12' : 'p-3.5 w-16 h-16'
                                }`}
                            onMouseDown={(e) => handleMouseDown(type, e)}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                        >
                            <span className={`leading-none transform group-hover:scale-125 transition-transform duration-200 ${horizontal ? 'text-2xl' : 'text-3xl'
                                }`}>{emoji}</span>
                        </button>
                    );
                })}
            </div>
        </>
    );
};

export default LiveStreamReactions;
