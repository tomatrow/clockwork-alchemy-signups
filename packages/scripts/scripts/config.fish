mise activate fish | source

# Exports every KEY=VALUE from one or more env files into the current shell.
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
# `center | fourth` when --fourth is given. Focus ends on the right pane.
#
# Pane indices are positional, not creation order, so only `-t 0` (the stable
# top-left pane) is referenced directly; everything else acts on the active pane.
function tmux_dev_panes
	# Flags are declared `=` (required value) rather than `=?` (optional), which
	# fish only accepts as `--flag=value`; the space-separated form used by
	# callers below needs `=`. --max-args=0 turns a stray positional into an error.
	argparse --max-args=0 'left=' 'right=' 'center=' 'fourth=' 'preamble=' 'name=' 'detached' -- $argv
	or return

	set -l cmd new-session

	# Named sessions make a second `pnpm start` fail loudly instead of stacking
	# an identical unnamed session. Use `tmux kill-session -t <name>` to clean up.
	if set -q _flag_name; and test -n "$_flag_name"
		set -a cmd -s $_flag_name
	end

	# Builds the session without attaching, for use from a non-tty.
	if set -q _flag_detached
		set -a cmd -d
	end

	set -a cmd ';' \
		send-keys "$_flag_preamble; $_flag_left" C-m ';' \
		split-window -v ';' \
		send-keys "$_flag_preamble; $_flag_center" C-m ';'

	# Splits the center pane, still the active one from above.
	if set -q _flag_fourth; and test -n "$_flag_fourth"
		set -a cmd split-window -h ';' \
			send-keys "$_flag_preamble; $_flag_fourth" C-m ';'
	end

	set -a cmd select-pane -t 0 ';' \
		split-window -h ';' \
		send-keys "$_flag_preamble; $_flag_right" C-m ';'

	tmux $cmd
end
