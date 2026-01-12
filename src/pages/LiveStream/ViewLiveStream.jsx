import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Api from '../../common/SummaryAPI';
import { useToast } from '../../hooks/useToast';
import {
    LiveTv,
    Fullscreen,
    FullscreenExit,
    Videocam,
    Chat,
    ArrowBack,
    ShoppingBag,
    Info
} from '@mui/icons-material';
import { LIVEKIT_CONFIG } from '../../config/livekit';
import LiveStreamComments from './LiveStreamComments';
import LiveStreamProducts from './LiveStreamProducts';

const LiveStreamDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { showToast } = useToast();

    const [selectedStream, setSelectedStream] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    // const [isFullscreen, setIsFullscreen] = useState(false); // Removed - no longer needed after removing toggle buttons
    // On mobile, hide panels by default for better video viewing experience
    const [showComments, setShowComments] = useState(true);
    const [showProducts, setShowProducts] = useState(true);
    const [showInfo, setShowInfo] = useState(true);

    // Detect mobile on mount
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth < 768;
            setIsMobile(mobile);
            // On mobile, hide panels by default for better video viewing experience
            if (mobile) {
                setShowInfo(false);
                setShowProducts(false);
                setShowComments(false);
            }
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);
    const [connectionState, setConnectionState] = useState('disconnected');
    const [streamEnded, setStreamEnded] = useState(false);
    const [_room, setRoom] = useState(null);
    const [remoteParticipants, setRemoteParticipants] = useState([]);

    const videoRef = useRef(null);
    const containerRef = useRef(null);
    const roomRef = useRef(null);
    const isReconnectingRef = useRef(false);
    const streamEndedRef = useRef(false);
    const socketRef = useRef(null);
    const hasJoinedRef = useRef(false);
    const streamDataRef = useRef(null); // Store stream data for connection

    // Helper: Format date/time to dd/mm/yyyy HH:mm
    const formatDateTime = (dateString) => {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${day}/${month}/${year} ${hours}:${minutes}`;
        } catch {
            return '';
        }
    };

    // Connect to LiveKit - moved before useEffect
    // This function is safe to call from multiple users simultaneously
    // Each user gets their own unique token and room connection
    const connectToLiveKit = useCallback(async (roomName, viewerToken, serverUrl = null) => {
        // Prevent multiple simultaneous connection attempts from the same user
        if (isReconnectingRef.current) return;
        if (streamEndedRef.current) return;

        if (!roomName || !viewerToken) {
            showToast('Missing connection information', 'error');
            return;
        }

        if (typeof viewerToken !== 'string' || viewerToken.length < 10) {
            showToast('Invalid token', 'error');
            return;
        }

        // Use serverUrl from API response, fallback to config, then to env
        // Validate serverUrl from API first - if invalid/empty, use fallback
        let livekitServerUrl = serverUrl;

        // Check if serverUrl from API is valid
        if (!livekitServerUrl ||
            typeof livekitServerUrl !== 'string' ||
            livekitServerUrl.trim() === '' ||
            livekitServerUrl.includes('your-livekit-server.com')) {
            // Fallback to config or env
            livekitServerUrl = LIVEKIT_CONFIG.serverUrl || import.meta.env.VITE_LIVEKIT_SERVER_URL;
        }

        // Final validation
        if (!livekitServerUrl ||
            typeof livekitServerUrl !== 'string' ||
            livekitServerUrl.trim() === '' ||
            livekitServerUrl.includes('your-livekit-server.com')) {
            console.error('LiveKit server URL not configured:', { serverUrl, config: LIVEKIT_CONFIG.serverUrl, env: import.meta.env.VITE_LIVEKIT_SERVER_URL });
            showToast('LiveKit server not configured', 'error');
            return;
        }

        if (!livekitServerUrl.startsWith('wss://') && !livekitServerUrl.startsWith('ws://')) {
            console.error('Invalid LiveKit server URL format:', livekitServerUrl);
            showToast('Invalid LiveKit server URL', 'error');
            return;
        }

        const originalConsoleError = console.error;

        try {
            isReconnectingRef.current = true;
            setConnectionState('connecting');

            const existingRoom = roomRef.current;
            if (existingRoom) {
                existingRoom.removeAllListeners();
                if (existingRoom.state !== 'disconnected') {
                    await existingRoom.disconnect();
                }
                await new Promise(resolve => setTimeout(resolve, 800));
                roomRef.current = null;
                setRoom(null);
            }

            const { Room, RoomEvent } = await import('livekit-client');

            const roomOptions = {
                adaptiveStream: true,
                dynacast: true,
                publishDefaults: {
                    videoEncoding: {
                        maxBitrate: 1_000_000,
                        maxFramerate: 30
                    },
                    red: false
                }
            };

            const newRoom = new Room(roomOptions);

            newRoom.on(RoomEvent.Connected, () => {
                setConnectionState('connected');

                // Initialize remote participants list (exclude local participant)
                const initialParticipants = Array.from(newRoom.remoteParticipants.values());
                setRemoteParticipants(initialParticipants);

                // CRITICAL: Ensure video element is not muted (audio always enabled)
                if (videoRef.current) {
                    videoRef.current.muted = false;
                }

                // Function to attach track to video element
                // This function is called for each user independently (up to 100 users)
                // Each user has their own videoRef, so there's no conflict
                const attachTrackToVideo = (track, kind) => {
                    if (!videoRef.current) {
                        // Retry if video element is not ready yet
                        // Important when multiple users join quickly - each waits for their own video element
                        setTimeout(() => {
                            if (videoRef.current && track) {
                                attachTrackToVideo(track, kind);
                            }
                        }, 100);
                        return;
                    }

                    if (kind === 'video') {
                        // Attach video track - LiveKit handles multiple attachments correctly
                        // Each user (up to 100) attaches to their own video element
                        // LiveKit delivers the same stream to all subscribers independently
                        track.attach(videoRef.current);
                        videoRef.current.muted = false;
                        videoRef.current.play().catch((err) => {
                            console.error('Video play error:', err);
                        });
                    } else if (kind === 'audio') {
                        // Attach audio track - each user gets their own audio stream
                        // LiveKit supports multiple audio subscribers (up to 100)
                        track.attach(videoRef.current);
                        if (track instanceof MediaStreamTrack) {
                            track.enabled = true;
                        }
                        if (videoRef.current) {
                            videoRef.current.muted = false;
                        }
                    }
                };

                // Subscribe to all remote tracks (video and audio) from all participants
                // This ensures ALL users (up to 100) can see the host's video stream
                // CRITICAL: Each user must subscribe independently to receive the stream data
                // LiveKit supports multiple subscribers to the same track - each user gets their own stream
                newRoom.remoteParticipants.forEach((participant) => {
                    participant.trackPublications.forEach((publication) => {
                        // CRITICAL: Force subscribe to tracks for THIS user
                        // This ensures each user gets their own subscription to the stream
                        // Even if 99 other users have already subscribed, this user needs their own subscription
                        // LiveKit handles multiple subscriptions correctly - each user receives the data independently
                        // IMPORTANT: Always set subscribed to true, even if already subscribed, to ensure this user's subscription is maintained
                        // This is critical to prevent subscription from being dropped when other users join
                        publication.setSubscribed(true);
                            }
                        }
                        // If track is not available yet, TrackSubscribed event will handle it
                        // TrackSubscribed fires for each user independently when their subscription is ready
                    });
                });

                // CRITICAL: Set up a listener to monitor track subscriptions
                // This ensures subscriptions are maintained even when room state changes
                const maintainSubscriptions = () => {
                    if (!newRoom || newRoom.state !== 'connected') {
                        return;
                    }
                    newRoom.remoteParticipants.forEach((participant) => {
                        participant.trackPublications.forEach((publication) => {
                            // Always ensure subscription is maintained for THIS user
                            if (!publication.isSubscribed && publication.track) {
                                publication.setSubscribed(true);
                            }
                        });
                    });
                };

                // Monitor subscriptions periodically
                const subscriptionMonitor = setInterval(maintainSubscriptions, 5000);
                if (!newRoom._subscriptionMonitor) {
                    newRoom._subscriptionMonitor = subscriptionMonitor;
                }

                // Double-check video is not muted after a short delay
                setTimeout(() => {
                    if (videoRef.current) {
                        videoRef.current.muted = false;
                    }
                }, 1000);

                // CRITICAL: Periodically verify track is still attached and subscription is maintained
                // This ensures tracks don't get lost when other users join/leave
                const verifyTracksInterval = setInterval(() => {
                    if (!videoRef.current || !newRoom || newRoom.state !== 'connected') {
                        clearInterval(verifyTracksInterval);
                        return;
                    }

                    // Check all remote participants' tracks
                    newRoom.remoteParticipants.forEach((participant) => {
                        participant.trackPublications.forEach((publication) => {
                            // CRITICAL: Always ensure subscription is maintained for THIS user
                            // This prevents subscription from being dropped when other users join
                            if (!publication.isSubscribed) {
                                publication.setSubscribed(true);
                            }

                            // Only process if track exists and is subscribed
                            if (!publication.track || !publication.isSubscribed) {
                                return;
                            }

                            // For video tracks, ensure they're attached and playing
                            if (publication.track.kind === 'video' && videoRef.current) {
                                // Check if video element has a source (track is attached)
                                const hasVideoSource = videoRef.current.srcObject !== null ||
                                    videoRef.current.src !== '';

                                if (!hasVideoSource) {
                                    // Track is not attached - re-attach it
                                    publication.track.attach(videoRef.current);
                                    videoRef.current.muted = false;
                                    videoRef.current.play().catch(() => { });
                                } else {
                                    // Track is attached, just ensure it's playing and not muted
                                    if (videoRef.current.paused) {
                                        videoRef.current.play().catch(() => { });
                                    }
                                    if (videoRef.current.muted) {
                                        videoRef.current.muted = false;
                                    }
                                }
                            }
                        });
                    });
                }, 3000); // Check every 3 seconds (less frequent to avoid overhead)

                // Store interval ID for cleanup
                if (!newRoom._trackVerificationInterval) {
                    newRoom._trackVerificationInterval = verifyTracksInterval;
                }
            });

            newRoom.on(RoomEvent.Disconnected, async (reason) => {
                setConnectionState('disconnected');
                setRoom(null);

                // Clear track verification interval
                if (newRoom._trackVerificationInterval) {
                    clearInterval(newRoom._trackVerificationInterval);
                    newRoom._trackVerificationInterval = null;
                }

                // Clear subscription monitor
                if (newRoom._subscriptionMonitor) {
                    clearInterval(newRoom._subscriptionMonitor);
                    newRoom._subscriptionMonitor = null;
                }

                // Clear remote participants
                setRemoteParticipants([]);

                // Leave livestream via API
                if (hasJoinedRef.current && selectedStream?._id) {
                    try {
                        const token = localStorage.getItem('token');
                        if (token) {
                            await Api.livestream.leave({ livestreamId: selectedStream._id }, token);
                            hasJoinedRef.current = false;
                        }
                    } catch (error) {
                        console.error('Error leaving livestream:', error);
                    }
                }

                if (reason === 'SERVER_SHUTDOWN' || reason === 'ROOM_DELETED') {
                    showToast('Livestream has ended', 'info');
                    streamEndedRef.current = true;
                    setStreamEnded(true);
                    setSelectedStream(prev => prev ? { ...prev, status: 'ended' } : null);
                }
            });

            newRoom.on(RoomEvent.TrackSubscribed, (track, publication) => {
                // This event fires when a track is subscribed for THIS user
                // CRITICAL: This is essential for users joining after stream has started
                // Each user (up to 100) gets their own TrackSubscribed event - this ensures all users receive the data
                // LiveKit sends separate subscription events for each user, so all 100 users get the stream independently
                // Multiple users can subscribe to the same track - LiveKit handles this correctly

                // CRITICAL: Ensure subscription is maintained
                if (publication && !publication.isSubscribed) {
                    publication.setSubscribed(true);
                }

                // Function to attach track with retry logic
                const attachTrack = () => {
                    if (!videoRef.current) {
                        // Retry if video element is not ready
                        // This ensures the track is attached even if DOM is not ready yet
                        // Important for users joining quickly one after another
                        setTimeout(attachTrack, 100);
                        return;
                    }

                    // CRITICAL: attach() is safe to call multiple times
                    // LiveKit handles multiple attachments correctly - each user's attachment is independent
                    // Calling attach() again on the same element is safe and won't affect other users
                    if (track.kind === 'video') {
                        // Attach video track - LiveKit handles multiple users (up to 100) correctly
                        // Each user attaches to their own video element, receiving the same stream data
                        // No conflict between users - each has their own video element and connection
                        // IMPORTANT: attach() creates a new attachment for THIS user's video element
                        // It does NOT affect other users' attachments
                        track.attach(videoRef.current);
                        setTimeout(() => {
                            if (videoRef.current) {
                                videoRef.current.muted = false;
                                videoRef.current.play().then(() => {
                                }).catch(err => {
                                    if (err.name !== 'AbortError') {
                                        console.error('Video play failed:', err);
                                    }
                                });
                            }
                        }, 100);
                    } else if (track.kind === 'audio') {
                        // Attach audio track - each user (up to 100) gets their own audio stream
                        // LiveKit delivers audio to each subscriber independently
                        track.attach(videoRef.current);
                        if (track instanceof MediaStreamTrack) {
                            track.enabled = true;
                        }
                        if (videoRef.current) {
                            videoRef.current.muted = false;
                            // Force unmute multiple times to ensure it sticks
                            setTimeout(() => {
                                if (videoRef.current) {
                                    videoRef.current.muted = false;
                                }
                            }, 100);
                            setTimeout(() => {
                                if (videoRef.current) {
                                    videoRef.current.muted = false;
                                }
                            }, 500);
                        }
                    }
                };

                // Try to attach immediately
                // This ensures the track is attached as soon as it's subscribed for this user
                // Works correctly even with 100 concurrent users
                attachTrack();
            });

            // Handle participant connected - subscribe to their tracks
            // This handles new participants joining (including host if they join later)
            newRoom.on(RoomEvent.ParticipantConnected, (participant) => {
                // Add participant to remote participants list (for viewer count)
                setRemoteParticipants(prev => {
                    // Check if participant already exists (avoid duplicates)
                    if (prev.find(p => p.identity === participant.identity)) {
                        return prev;
                    }
                    return [...prev, participant];
                });

                // CRITICAL: When a new participant joins, ensure THIS user's existing subscriptions are maintained
                // This prevents THIS user's tracks from being dropped when other users join
                newRoom.remoteParticipants.forEach((existingParticipant) => {
                    existingParticipant.trackPublications.forEach((existingPublication) => {
                        if (existingPublication.isSubscribed && existingPublication.track) {
                            // Re-assert subscription to ensure it's maintained
                            existingPublication.setSubscribed(true);
                            // Re-attach if needed to ensure track is still connected
                            if (existingPublication.track.kind === 'video' && videoRef.current) {
                                existingPublication.track.attach(videoRef.current);
                                videoRef.current.muted = false;
                                videoRef.current.play().catch(() => { });
                            }
                        }
                    });
                });

                // Subscribe to all their tracks (host publishes video/audio, viewers don't)
                // CRITICAL: Force subscribe to ensure THIS user gets the tracks
                // Each user (up to 100) must subscribe independently to receive the stream data
                // LiveKit supports multiple subscribers - each user gets their own stream independently
                participant.trackPublications.forEach((publication) => {
                    // CRITICAL: Always set subscribed to true to maintain THIS user's subscription
                    // Even if already subscribed, ensure subscription is maintained
                    // This prevents subscription from being dropped when other users join
                    publication.setSubscribed(true);

                    // If tracks are already available, attach them immediately
                    // This handles the case when host joins after viewer, or when new participant joins
                    // Each user attaches to their own video element, so all 100 users receive the data
                    // No conflict - each user has their own video element and connection
                    // IMPORTANT: attach() is safe to call multiple times - LiveKit handles it correctly
                    if (publication.track && videoRef.current) {
                        if (publication.track.kind === 'video') {
                            // Attach video track from host - each user (up to 100) gets their own stream
                            // LiveKit delivers the same video stream to all subscribers independently
                            // IMPORTANT: attach() creates a new attachment for THIS user's video element
                            // It does NOT affect other users' attachments
                            publication.track.attach(videoRef.current);
                            videoRef.current.muted = false;
                            videoRef.current.play().catch((err) => {
                                if (err.name !== 'AbortError') {
                                    console.error('Video play failed:', err);
                                }
                            });
                        } else if (publication.track.kind === 'audio') {
                            // Attach audio track from host - each user (up to 100) gets their own stream
                            // LiveKit delivers the same audio stream to all subscribers independently
                            publication.track.attach(videoRef.current);
                            if (publication.track instanceof MediaStreamTrack) {
                                publication.track.enabled = true;
                            }
                            videoRef.current.muted = false;
                        }
                    }
                    // If track is not available yet, TrackSubscribed event will handle it
                    // TrackSubscribed fires for each user independently when their subscription is ready
                    // Works correctly even with 100 concurrent users
                });
            });

            newRoom.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
                // CRITICAL: Only detach if this track is actually unsubscribed for THIS user
                // TrackUnsubscribed fires when THIS user's subscription ends
                // IMPORTANT: Do NOT detach if subscription was dropped due to other users joining
                // Only detach if the publication is truly unsubscribed for THIS user
                if (videoRef.current && publication) {
                    // Double-check: Only detach if publication is confirmed unsubscribed
                    // Sometimes TrackUnsubscribed fires temporarily - we should verify
                    if (!publication.isSubscribed) {
                        // Wait a bit to see if subscription is restored
                        setTimeout(() => {
                            // Only detach if still unsubscribed after delay
                            if (videoRef.current && publication && !publication.isSubscribed) {
                                if (track.kind === 'video') {
                                    track.detach(videoRef.current);
                                } else if (track.kind === 'audio') {
                                    track.detach(videoRef.current);
                                }
                            }
                        }, 500);
                    }
                }
            });

            // Handle participant disconnected - remove from list
            newRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
                setRemoteParticipants(prev => prev.filter(p => p.identity !== participant.identity));
            });

            console.error = (...args) => {
                const message = args[0]?.toString() || '';
                if (message.includes('DataChannel error')) {
                    return;
                }
                originalConsoleError.apply(console, args);
            };

            const connectPromise = newRoom.connect(livekitServerUrl, viewerToken);
            const timeoutPromise = new Promise((_, reject) => {
                const timeoutId = setTimeout(() => {
                    reject(new Error(`Connection timeout after 45 seconds`));
                }, 45000);
                connectPromise.then(() => clearTimeout(timeoutId)).catch(() => clearTimeout(timeoutId));
            });

            try {
                await Promise.race([connectPromise, timeoutPromise]);
            } catch (error) {
                try {
                    newRoom.removeAllListeners();
                    if (newRoom.state !== 'disconnected' && newRoom.state !== 'disconnecting') {
                        await Promise.race([
                            newRoom.disconnect(),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Disconnect timeout')), 5000))
                        ]).catch(() => { });
                    }
                } catch (disconnectError) {
                    console.warn('Error during cleanup:', disconnectError.message);
                } finally {
                    if (roomRef.current === newRoom) {
                        roomRef.current = null;
                    }
                    setRoom(null);
                }
                throw error;
            }

            setRoom(newRoom);
            roomRef.current = newRoom;
            isReconnectingRef.current = false;
            console.error = originalConsoleError;
            return newRoom;
        } catch (error) {
            if (typeof originalConsoleError !== 'undefined') {
                console.error = originalConsoleError;
            }
            setConnectionState('error');
            isReconnectingRef.current = false;

            if (error.message.includes('timeout')) {
                showToast('Connection timeout. Please check network', 'error');
            } else if (error.message.includes('token')) {
                showToast('Invalid or expired token', 'error');
            } else if (error.message.includes('server')) {
                showToast('Unable to connect to server', 'error');
            } else {
                showToast(`Connection error: ${error.message}`, 'error');
            }
            throw error;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showToast]);

    // Load stream details
    useEffect(() => {
        const loadStream = async () => {
            try {
                setIsLoading(true);
                const token = localStorage.getItem('token');
                if (!token) {
                    showToast('Please login to view livestream', 'error');
                    navigate('/');
                    return;
                }

                const response = await Api.livestream.join({ livestreamId: id }, token);

                if (response.data?.success) {
                    const streamData = response.data.data;

                    if (streamData.status !== 'live') {
                        showToast('Livestream has ended', 'info');
                        setStreamEnded(true);
                        setSelectedStream(streamData);
                        return;
                    }

                    // Store stream data for connection
                    streamDataRef.current = streamData;
                    setSelectedStream(streamData);
                    hasJoinedRef.current = true; // Mark as joined
                } else {
                    showToast('Livestream not found', 'error');
                    navigate('/');
                }
            } catch (error) {
                console.error('Error loading stream:', error);
                showToast('Error loading livestream', 'error');
                navigate('/');
            } finally {
                setIsLoading(false);
            }
        };

        loadStream();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    // Connect to LiveKit when both stream data and video element are ready
    useEffect(() => {
        const connectWhenReady = async () => {
            // Wait for both selectedStream and videoRef to be available
            if (!selectedStream || !streamDataRef.current || streamDataRef.current.status !== 'live') {
                return;
            }

            // Wait for video element to be mounted in DOM
            let retries = 0;
            const maxRetries = 20; // Increased retries for slower devices
            while (!videoRef.current && retries < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
            }

            if (!videoRef.current) {
                console.error('Video element not found after waiting');
                showToast('Video player not ready', 'error');
                return;
            }

            // Check if already connected
            if (roomRef.current && roomRef.current.state === 'connected') {
                return;
            }

            // Connect to LiveKit - use serverUrl from API response
            try {
                await connectToLiveKit(
                    streamDataRef.current.roomName,
                    streamDataRef.current.viewerToken,
                    streamDataRef.current.serverUrl
                );
                showToast('Joined livestream!', 'success');
            } catch (error) {
                console.error('Error connecting to LiveKit:', error);
                // Error toast is already shown in connectToLiveKit
            }
        };

        connectWhenReady();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStream, connectToLiveKit]);

    // Note: Reactions and Floating Reactions are now handled inside LiveStreamReactions component

    const disconnectFromLiveKit = useCallback(async () => {
        const roomToDisconnect = roomRef.current;
        if (!roomToDisconnect) return;

        try {
            roomToDisconnect.removeAllListeners();
            await new Promise(resolve => setTimeout(resolve, 300));

            if (roomToDisconnect.state !== 'disconnected') {
                await Promise.race([
                    roomToDisconnect.disconnect(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Disconnect timeout')), 5000))
                ]).catch(() => { });
            }
        } catch (error) {
            console.error('Error disconnecting:', error.message);
        } finally {
            if (roomRef.current === roomToDisconnect) {
                roomRef.current = null;
            }
            setRoom(null);
            setConnectionState('disconnected');
            isReconnectingRef.current = false;
        }
    }, []);

    const leaveLivestream = async () => {
        try {
            // Leave via API
            if (hasJoinedRef.current && selectedStream?._id) {
                const token = localStorage.getItem('token');
                if (token) {
                    try {
                        await Api.livestream.leave({ livestreamId: selectedStream._id }, token);
                        hasJoinedRef.current = false;
                    } catch (apiError) {
                        console.error('Error calling leave API:', apiError);
                    }
                }
            }
            await disconnectFromLiveKit();
            showToast('Left livestream', 'info');
        } catch (error) {
            console.error('Error leaving livestream:', error);
        }
    };

    // const toggleFullscreen = () => {
    //     if (!document.fullscreenElement) {
    //         containerRef.current?.requestFullscreen();
    //         setIsFullscreen(true);
    //     } else {
    //         document.exitFullscreen();
    //         setIsFullscreen(false);
    //     }
    // };

    // Mute functionality removed

    const goBack = () => {
        leaveLivestream();
        navigate('/');
    };

    useEffect(() => {
        const room = roomRef.current;
        const socket = socketRef.current;

        return () => {
            // Leave livestream if still joined
            if (hasJoinedRef.current && selectedStream?._id) {
                const token = localStorage.getItem('token');
                if (token) {
                    Api.livestream.leave({ livestreamId: selectedStream._id }, token).catch(console.error);
                    hasJoinedRef.current = false;
                }
            }

            if (room) {
                room.disconnect().catch(console.error);
            }
            if (socket) {
                socket.disconnect();
            }
        };
    }, [selectedStream?._id]);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black flex items-center justify-center">
                <div className="text-center">
                    <div className="relative">
                        <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-800 mx-auto mb-6"></div>
                        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-red-500 mx-auto absolute top-0 left-1/2 transform -translate-x-1/2"></div>
                    </div>
                    <p className="text-gray-300 text-lg font-medium">Loading livestream...</p>
                    <p className="text-gray-500 text-sm mt-2">Please wait a moment</p>
                </div>
            </div>
        );
    }

    if (streamEnded) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black flex items-center justify-center p-4">
                <div className="text-center text-white max-w-md">
                    <div className="relative mb-8">
                        <div className="w-24 h-24 bg-gradient-to-br from-red-500/20 to-pink-500/20 rounded-full flex items-center justify-center mb-6 mx-auto backdrop-blur-sm border border-red-500/30">
                            <LiveTv className="w-12 h-12 text-red-400" />
                        </div>
                        <div className="absolute inset-0 bg-red-500/20 rounded-full animate-ping opacity-20"></div>
                    </div>
                    <h3 className="text-3xl font-bold mb-3 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        Livestream has ended
                    </h3>
                    <p className="text-gray-400 mb-8 text-lg">Thank you for watching!</p>
                    <button
                        type="button"
                        onClick={goBack}
                        className="px-8 py-3 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-xl hover:from-red-700 hover:to-pink-700 transition-all duration-300 transform hover:scale-105 shadow-lg shadow-red-500/50 font-medium"
                    >
                        Back to Home
                    </button>
                </div>
            </div>
        );
    }

    if (!selectedStream) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black flex items-center justify-center p-4">
                <div className="text-center text-white max-w-md">
                    <div className="w-20 h-20 bg-gray-700/50 rounded-full flex items-center justify-center mb-6 mx-auto backdrop-blur-sm border border-gray-600/50">
                        <LiveTv className="w-10 h-10 text-gray-400" />
                    </div>
                    <h3 className="text-3xl font-bold mb-3 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                        Livestream not found
                    </h3>
                    <p className="text-gray-400 mb-8">The livestream you're looking for doesn't exist or has been removed.</p>
                    <button
                        type="button"
                        onClick={goBack}
                        className="px-8 py-3 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-xl hover:from-red-700 hover:to-pink-700 transition-all duration-300 transform hover:scale-105 shadow-lg shadow-red-500/50 font-medium"
                    >
                        Back to Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black"
            onContextMenu={(e) => e.preventDefault()}
        >
            {/* Video Modal - Full Screen */}
            <div
                className="fixed inset-0 bg-gradient-to-br from-black via-gray-900 to-black z-50 flex items-center justify-center p-0 md:p-4"
                onClick={(e) => {
                    // Prevent default behavior for any clicks on background
                    if (e.target === e.currentTarget) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }}
            >
                <div
                    className={`relative bg-black/90 backdrop-blur-xl overflow-hidden transition-all duration-500 shadow-2xl border border-gray-800/50
                        w-full h-full md:w-auto md:h-auto
                        rounded-none md:rounded-2xl
                        ${showInfo ? 'md:ml-80' : ''}
                        ${showComments && showProducts
                            ? 'md:mr-[640px]'
                            : showComments
                                ? 'md:mr-[352px]'
                                : showProducts
                                    ? 'md:mr-[288px]'
                                    : ''
                        }
                    `}
                    style={{
                        width: showInfo && showComments && showProducts
                            ? 'min(calc(100vw - 960px), calc((100vh - 2rem) * 9 / 16))'
                            : showInfo && showComments
                                ? 'min(calc(100vw - 672px), calc((100vh - 2rem) * 9 / 16))'
                                : showInfo && showProducts
                                    ? 'min(calc(100vw - 608px), calc((100vh - 2rem) * 9 / 16))'
                                    : showInfo
                                        ? 'min(calc(100vw - 340px), calc((100vh - 2rem) * 9 / 16))'
                                        : showComments && showProducts
                                            ? 'min(calc(100vw - 640px), calc((100vh - 2rem) * 9 / 16))'
                                            : showComments
                                                ? 'min(calc(100vw - 372px), calc((100vh - 2rem) * 9 / 16))'
                                                : showProducts
                                                    ? 'min(calc(100vw - 308px), calc((100vh - 2rem) * 9 / 16))'
                                                    : 'min(90vw, calc((100vh - 2rem) * 9 / 16))',
                        aspectRatio: '9/16',
                        maxWidth: '90vw',
                        maxHeight: 'calc(100vh - 2rem)'
                    }}
                    ref={containerRef}
                    onClick={(e) => {
                        // Prevent any navigation or reload from container clicks
                        const target = e.target;
                        if (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'SVG' || target.closest('svg')) {
                            e.preventDefault();
                            e.stopPropagation();
                            return false;
                        }
                    }}
                    onMouseDown={(e) => {
                        // Prevent any mouse down events on buttons from propagating
                        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                    }}
                >
                    <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        controls={false}
                        muted={false}
                        className="w-full h-full object-cover cursor-pointer"
                        style={{ backgroundColor: '#000' }}
                        onError={(e) => console.error('Video error:', e)}
                        onClick={(e) => {
                            // Prevent video clicks from bubbling up
                            e.stopPropagation();
                        }}
                    />

                    {/* Back Button */}
                    <button
                        type="button"
                        onClick={goBack}
                        className="absolute top-2 left-2 md:top-3 md:left-3 bg-black/60 backdrop-blur-md text-white p-2 md:p-2.5 rounded-full hover:bg-black/80 transition-all duration-300 z-50 border border-white/10 shadow-lg hover:scale-110 transform active:scale-95"
                    >
                        <ArrowBack className="w-4 h-4 md:w-5 md:h-5" />
                    </button>

                    {/* Status & Viewers */}
                    <div className="absolute top-2 right-2 md:top-3 md:right-3 flex flex-col items-end gap-2">
                        <div className={`flex items-center gap-1.5 md:gap-2 px-2 py-1 md:px-3 md:py-1.5 rounded-full text-[10px] md:text-xs font-bold backdrop-blur-md border transition-all duration-300 shadow-lg ${connectionState === 'connected'
                            ? 'bg-gradient-to-r from-red-600 to-pink-600 text-white border-red-500/50 animate-pulse'
                            : connectionState === 'connecting'
                                ? 'bg-gradient-to-r from-yellow-500 to-orange-500 text-white border-yellow-500/50'
                                : connectionState === 'error'
                                    ? 'bg-gradient-to-r from-red-700 to-red-800 text-white border-red-600/50'
                                    : 'bg-gray-700/80 text-white border-gray-600/50'
                            }`}>
                            <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${connectionState === 'connected'
                                ? 'bg-white animate-ping'
                                : connectionState === 'connecting'
                                    ? 'bg-white animate-pulse'
                                    : 'bg-white'
                                }`}></div>
                            <span>
                                {connectionState === 'connected' ? 'LIVE' :
                                    connectionState === 'connecting' ? 'CONNECTING' :
                                        connectionState === 'error' ? 'ERROR' : 'ENDED'}
                            </span>
                        </div>

                        {selectedStream && (
                            <div className="bg-black/60 backdrop-blur-md text-white px-2 py-1 md:px-3 md:py-1.5 rounded-full text-xs md:text-sm font-medium flex items-center gap-1.5 md:gap-2 border border-white/10 shadow-lg">
                                <Videocam className="w-3 h-3 md:w-4 md:h-4 text-blue-400" />
                                <span className="text-white font-semibold text-xs md:text-sm">{remoteParticipants.length}</span>
                                <span className="text-[10px] md:text-xs text-gray-300">viewers</span>
                            </div>
                        )}
                    </div>

                    {/* Ended Overlay */}
                    {connectionState !== 'connected' && !streamEnded && (
                        <div className="absolute inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center">
                            <div className="text-center text-white">
                                <div className="relative mb-6">
                                    <div className="w-20 h-20 bg-gradient-to-br from-gray-700/50 to-gray-800/50 rounded-full flex items-center justify-center mx-auto backdrop-blur-md border border-gray-600/30">
                                        <LiveTv className="w-10 h-10 text-gray-400" />
                                    </div>
                                    <div className="absolute inset-0 bg-gray-500/20 rounded-full animate-ping"></div>
                                </div>
                                <h3 className="text-2xl font-bold mb-2 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                                    Livestream has ended
                                </h3>
                                <p className="text-gray-300 mb-6">Thank you for watching!</p>
                                <button
                                    type="button"
                                    onClick={goBack}
                                    className="px-6 py-2.5 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-xl hover:from-red-700 hover:to-pink-700 transition-all duration-300 transform hover:scale-105 shadow-lg shadow-red-500/50 font-medium"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Controls - Bottom buttons */}
                    <div
                        className="absolute bottom-2 left-2 right-2 md:bottom-3 md:left-3 md:right-3 flex items-center justify-between pointer-events-auto z-10"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-1.5 md:gap-2">
                            <button
                                type="button"
                                onClick={() => setShowInfo(!showInfo)}
                                className={`bg-black/60 backdrop-blur-md text-white p-2 md:p-2.5 rounded-full hover:bg-black/80 transition-all duration-300 border border-white/10 shadow-lg hover:scale-110 active:scale-95 transform ${showInfo ? 'bg-gradient-to-r from-blue-600/80 to-indigo-600/80 border-blue-500/50' : ''
                                    }`}
                            >
                                <Info className="w-4 h-4 md:w-5 md:h-5" />
                            </button>
                        </div>

                        <div className="flex items-center gap-1.5 md:gap-2">
                            <button
                                type="button"
                                onClick={() => setShowProducts(!showProducts)}
                                className={`bg-black/60 backdrop-blur-md text-white p-2 md:p-2.5 rounded-full hover:bg-black/80 transition-all duration-300 border border-white/10 shadow-lg hover:scale-110 active:scale-95 transform ${showProducts ? 'bg-gradient-to-r from-green-600/80 to-emerald-600/80 border-green-500/50' : ''
                                    }`}
                            >
                                <ShoppingBag className="w-4 h-4 md:w-5 md:h-5" />
                            </button>

                            <button
                                type="button"
                                onClick={() => setShowComments(!showComments)}
                                className={`bg-black/60 backdrop-blur-md text-white p-2 md:p-2.5 rounded-full hover:bg-black/80 transition-all duration-300 border border-white/10 shadow-lg hover:scale-110 active:scale-95 transform ${showComments ? 'bg-gradient-to-r from-red-600/80 to-pink-600/80 border-red-500/50' : ''
                                    }`}
                            >
                                <Chat className="w-4 h-4 md:w-5 md:h-5" />
                            </button>
                        </div>
                    </div>

                </div>

                {/* Backdrop for mobile panels */}
                {(showInfo || showProducts) && (
                    <div
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[35] md:hidden"
                        onClick={() => {
                            setShowInfo(false);
                            setShowProducts(false);
                        }}
                    />
                )}

                {/* Info Panel - Left side of Video (Desktop) / Overlay (Mobile) */}
                {showInfo && selectedStream && (
                    <div className={`fixed left-0 top-0 h-full w-full md:w-80 bg-black/95 backdrop-blur-xl flex flex-col z-[40] shadow-2xl pointer-events-auto border-r border-gray-800/50 md:border-r-0 transition-transform duration-300 ${isMobile ? (showInfo ? 'translate-x-0' : '-translate-x-full') : ''}`}>
                        <div className="bg-gradient-to-br from-black via-gray-900 to-black p-3 flex items-center justify-between border-b border-gray-700/50 shadow-lg">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20">
                                    <Info className="w-4 h-4 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-white font-bold text-sm">Information</h3>
                                    <p className="text-white/70 text-[10px]">Livestream details</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowInfo(false)}
                                className="text-white hover:bg-white/20 active:bg-white/30 p-1.5 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 transform border border-white/10"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 md:p-3 space-y-3 scrollbar-livestream">
                            {/* Title */}
                            <div className="bg-gradient-to-r from-blue-600/10 to-purple-600/10 p-3 rounded-lg border border-blue-500/20">
                                <h2 className="text-white font-bold text-base md:text-sm leading-tight">
                                    {selectedStream.title || 'Untitled Livestream'}
                                </h2>
                            </div>

                            {/* Description */}
                            {selectedStream.description && (
                                <div className="bg-gray-800/30 p-3 rounded-lg border border-gray-700/30">
                                    <h4 className="text-blue-400 text-xs md:text-[10px] font-bold mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                                        <svg className="w-3 h-3 md:w-2.5 md:h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" />
                                        </svg>
                                        Description
                                    </h4>
                                    <p className="text-gray-300 text-sm md:text-xs leading-relaxed">
                                        {selectedStream.description}
                                    </p>
                                </div>
                            )}

                            {/* Host Info */}
                            {selectedStream.hostId && (
                                <div className="bg-gray-800/30 p-3 rounded-lg border border-gray-700/30">
                                    <h4 className="text-blue-400 text-xs md:text-[10px] font-bold mb-2 uppercase tracking-wider flex items-center gap-1.5">
                                        <svg className="w-3 h-3 md:w-2.5 md:h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                            <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                                        </svg>
                                        Host
                                    </h4>
                                    <div>
                                        <p className="text-white font-semibold text-sm md:text-xs">
                                            {selectedStream.hostId?.name || 'Unknown Host'}
                                        </p>
                                        {selectedStream.hostId?.email && (
                                            <p className="text-gray-400 text-xs md:text-[10px] mt-0.5">{selectedStream.hostId.email}</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Stream Time */}
                            <div className="bg-gray-800/30 p-3 rounded-lg border border-gray-700/30">
                                <h4 className="text-blue-400 text-xs md:text-[10px] font-bold mb-2 uppercase tracking-wider flex items-center gap-1.5">
                                    <svg className="w-3 h-3 md:w-2.5 md:h-2.5" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                                    </svg>
                                    Stream Schedule
                                </h4>
                                <div className="space-y-2">
                                    {selectedStream.startTime && (
                                        <div className="flex items-start gap-2">
                                            <div className="w-2 h-2 md:w-1.5 md:h-1.5 bg-green-500 rounded-full mt-1.5 flex-shrink-0"></div>
                                            <div>
                                                <span className="text-gray-400 text-xs md:text-[10px] block mb-0.5">Started</span>
                                                <p className="text-white text-sm md:text-xs font-medium">
                                                    {formatDateTime(selectedStream.startTime)}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                    {selectedStream.endTime && selectedStream.status !== 'live' && (
                                        <div className="flex items-start gap-2">
                                            <div className="w-2 h-2 md:w-1.5 md:h-1.5 bg-red-500 rounded-full mt-1.5 flex-shrink-0"></div>
                                            <div>
                                                <span className="text-gray-400 text-xs md:text-[10px] block mb-0.5">Ended</span>
                                                <p className="text-white text-sm md:text-xs font-medium">
                                                    {formatDateTime(selectedStream.endTime)}
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Products Panel - Between Video and Comments (Desktop) / Overlay (Mobile) */}
                {showProducts && (selectedStream?._id || id) && (
                    <div className={`fixed top-0 h-full w-full md:w-[288px] bg-black/95 backdrop-blur-xl flex flex-col z-[40] shadow-2xl pointer-events-auto ${showComments ? 'md:right-[352px] right-0' : 'right-0'
                        } border-l border-gray-800/50 transition-transform duration-300 ${isMobile ? (showProducts ? 'translate-x-0' : 'translate-x-full') : ''}`}>
                        <div className="bg-gradient-to-br from-black via-gray-900 to-black p-3 flex items-center justify-between border-b border-gray-700/50 shadow-lg">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border border-white/20">
                                    <ShoppingBag className="w-4 h-4 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-white font-bold text-sm">Products</h3>
                                    <p className="text-white/70 text-[10px]">Featured items</p>
                                </div>
                            </div>
                            {/* <button
                                onClick={() => setShowProducts(false)}
                                className="text-white hover:bg-white/20 active:bg-white/30 p-1.5 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 transform border border-white/10"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button> */}
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 scrollbar-livestream">
                            <LiveStreamProducts key={`products-${selectedStream?._id || id}-${showProducts}`} liveId={selectedStream?._id || id} />
                        </div>
                    </div>
                )}

                {/* Comments Panel */}
                {(selectedStream?._id || id) && (
                    <LiveStreamComments
                        liveId={selectedStream?._id || id}
                        hostId={selectedStream?.hostId?._id || selectedStream?.hostId}
                        isVisible={showComments}
                        onToggle={() => setShowComments(!showComments)}
                    />
                )}
            </div>
        </div>
    );
};

export default LiveStreamDetail;