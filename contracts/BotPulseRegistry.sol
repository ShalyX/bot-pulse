// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title BotPulseRegistry
/// @notice Testnet DePIN heartbeat registry for BOT Chain. Devices or gateways register IDs
/// and anchor signed/off-chain data packets as cheap on-chain freshness proofs.
contract BotPulseRegistry {
    uint256 public constant FRESHNESS_WINDOW = 15 minutes;

    struct Device {
        address owner;
        string metadataURI;
        uint64 registeredAt;
        uint64 lastSeenAt;
        uint64 heartbeatCount;
        bytes32 latestDataHash;
        string latestMetricType;
        int256 latestValue;
        bool active;
    }

    mapping(bytes32 => Device) private devices;
    bytes32[] private deviceIds;

    event DeviceRegistered(bytes32 indexed deviceId, address indexed owner, string metadataURI);
    event HeartbeatSubmitted(
        bytes32 indexed deviceId,
        address indexed submitter,
        bytes32 indexed dataHash,
        string metricType,
        int256 value,
        uint256 observedAt
    );
    event DeviceMetadataUpdated(bytes32 indexed deviceId, string metadataURI);
    event DeviceDeactivated(bytes32 indexed deviceId);

    modifier onlyDeviceOwner(bytes32 deviceId) {
        require(devices[deviceId].owner == msg.sender, "not device owner");
        _;
    }

    function registerDevice(bytes32 deviceId, string calldata metadataURI) external {
        require(deviceId != bytes32(0), "empty device id");
        require(devices[deviceId].owner == address(0), "device exists");

        devices[deviceId] = Device({
            owner: msg.sender,
            metadataURI: metadataURI,
            registeredAt: uint64(block.timestamp),
            lastSeenAt: 0,
            heartbeatCount: 0,
            latestDataHash: bytes32(0),
            latestMetricType: "",
            latestValue: 0,
            active: true
        });
        deviceIds.push(deviceId);

        emit DeviceRegistered(deviceId, msg.sender, metadataURI);
    }

    function submitHeartbeat(
        bytes32 deviceId,
        bytes32 dataHash,
        string calldata metricType,
        int256 value
    ) external onlyDeviceOwner(deviceId) {
        Device storage device = devices[deviceId];
        require(device.active, "device inactive");
        require(dataHash != bytes32(0), "empty data hash");
        require(bytes(metricType).length > 0, "empty metric");

        device.lastSeenAt = uint64(block.timestamp);
        device.heartbeatCount += 1;
        device.latestDataHash = dataHash;
        device.latestMetricType = metricType;
        device.latestValue = value;

        emit HeartbeatSubmitted(deviceId, msg.sender, dataHash, metricType, value, block.timestamp);
    }

    function updateMetadata(bytes32 deviceId, string calldata metadataURI) external onlyDeviceOwner(deviceId) {
        devices[deviceId].metadataURI = metadataURI;
        emit DeviceMetadataUpdated(deviceId, metadataURI);
    }

    function deactivateDevice(bytes32 deviceId) external onlyDeviceOwner(deviceId) {
        devices[deviceId].active = false;
        emit DeviceDeactivated(deviceId);
    }

    function getDevice(bytes32 deviceId) external view returns (Device memory) {
        require(devices[deviceId].owner != address(0), "unknown device");
        return devices[deviceId];
    }

    function isFresh(bytes32 deviceId) public view returns (bool) {
        Device storage device = devices[deviceId];
        if (device.owner == address(0) || !device.active || device.lastSeenAt == 0) {
            return false;
        }
        return block.timestamp <= uint256(device.lastSeenAt) + FRESHNESS_WINDOW;
    }

    function deviceCount() external view returns (uint256) {
        return deviceIds.length;
    }

    function listDeviceIds() external view returns (bytes32[] memory) {
        return deviceIds;
    }
}
