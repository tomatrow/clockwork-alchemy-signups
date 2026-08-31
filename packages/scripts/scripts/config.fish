mise activate fish | source

# Export every KEY=VALUE from one or more env files into the current shell.
# Used because the values in packages/database/.env.*.local are read by
# `pocketbase migrate` at migrate time via $os.getenv — they are process env,
# not something PocketBase loads itself.
function srcenv
	for env_filename in $argv
		test -f $env_filename; or continue
		cat $env_filename | grep -vE '^(#|\s*$)' | while read line
			set item (string split -m 1 '=' $line)
			set --export --global $item[1] $item[2]
		end
	end
end

# Lays out `left | right` across the top and `center` below it — full width, or
# `center | fourth` when --fourth is given. Focus ends on the right pane either
# way (`split-window` focuses the pane it creates, so `right` is built last).
#
# **Pane indices are positional, not creation order.** tmux renumbers on every
# split, so the pane that was `-t 1` a moment ago is a different one afterwards.
# Hence the only index referenced here is `-t 0`, which is stably the top-left
# pane; everything else relies on split-window acting on the active pane. Get
# this wrong and the fourth pane silently splits the WRONG neighbour — it looks
# plausible until you notice which command landed where.
#
# The tmux argument list is built up rather than written inline with escaped
# `\;` separators, because the fourth pane is conditional. A quoted ';' reaches
# tmux as the same literal separator `\;` does.
function tmux_dev_panes
	# Every flag is declared `=` (value REQUIRED when the flag is present), never
	# `=?` (value optional). fish accepts an optional-value flag ONLY as
	# `--flag=value`; given `--flag value` it sets the flag empty and leaves the
	# value in $argv as a stray positional. Callers below use the space-separated
	# form, so `=?` silently drops panes on the floor. `=` accepts both forms, and
	# omitting a flag entirely is still fine either way.
	#
	# --max-args=0 then turns such a stray positional into a loud failure rather
	# than a silently missing pane — which is how the `=?` bug went unnoticed.
	argparse --max-args=0 'left=' 'right=' 'center=' 'fourth=' 'preamble=' 'name=' 'detached' -- $argv
	or return

	set -l cmd new-session

	# Named so the loop is addressable (`tmux kill-session -t <name>`) and so a
	# second `pnpm start` collides loudly instead of silently stacking an
	# identical unnamed session. NEVER reach for `tmux kill-server` to clean up —
	# that takes out every unrelated session on the machine.
	if set -q _flag_name; and test -n "$_flag_name"
		set -a cmd -s $_flag_name
	end

	# --detached builds the session without attaching: needed to exercise this
	# function from a non-tty (a script, CI, an agent), where the attaching form
	# dies with "open terminal failed: not a terminal".
	if set -q _flag_detached
		set -a cmd -d
	end

	set -a cmd ';' \
		send-keys "$_flag_preamble; $_flag_left" C-m ';' \
		split-window -v ';' \
		send-keys "$_flag_preamble; $_flag_center" C-m ';'

	# Splits the center pane, which is still the active one from above.
	if set -q _flag_fourth; and test -n "$_flag_fourth"
		set -a cmd split-window -h ';' \
			send-keys "$_flag_preamble; $_flag_fourth" C-m ';'
	end

	set -a cmd select-pane -t 0 ';' \
		split-window -h ';' \
		send-keys "$_flag_preamble; $_flag_right" C-m ';'

	tmux $cmd
end
