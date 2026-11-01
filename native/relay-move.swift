import Darwin

// Never replace a destination, including when it appears during the move.
guard CommandLine.arguments.count == 3 else { exit(64) }
if renamex_np(CommandLine.arguments[1], CommandLine.arguments[2], UInt32(RENAME_EXCL)) != 0 {
    exit(errno == EEXIST ? 17 : 1)
}
